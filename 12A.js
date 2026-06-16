/* === 光标深度修正 === */
AFRAME.registerComponent("keyboard-speed-boost", {
  schema: {
    normal: { type: "number", default: 3 },
    boost:  { type: "number", default: 15 }
  },

  init: function () {
    this.boosting = false;
    this.keys = {};
    this._dir = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._delta = new THREE.Vector3();
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);

    this.setSpeed(this.data.normal);
  },

  remove: function () {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.setSpeed(this.data.normal);
  },

  onKeyDown: function (event) {
    if (this.isMoveKey(event)) this.keys[event.code] = true;
    if (!this.isShift(event)) return;
    this.boosting = true;
  },

  onKeyUp: function (event) {
    if (this.isMoveKey(event)) this.keys[event.code] = false;
    if (!this.isShift(event)) return;
    this.boosting = false;
  },

  onBlur: function () {
    this.boosting = false;
    this.keys = {};
    this.setSpeed(this.data.normal);
  },

  isShift: function (event) {
    return event.key === "Shift" || event.code === "ShiftLeft" || event.code === "ShiftRight";
  },

  isMoveKey: function (event) {
    return event.code === "KeyW" || event.code === "KeyA" || event.code === "KeyS" || event.code === "KeyD";
  },

  setSpeed: function (speed) {
    var controls = this.el.getAttribute("wasd-controls") || {};
    controls.acceleration = speed;
    this.el.setAttribute("wasd-controls", controls);
  },

  tick: function (time, delta) {
    if (!this.boosting) return;

    var moveX = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    var moveZ = (this.keys.KeyW ? 1 : 0) - (this.keys.KeyS ? 1 : 0);
    if (moveX === 0 && moveZ === 0) return;

    this.el.object3D.getWorldDirection(this._dir);
    this._fwd.set(-this._dir.x, 0, -this._dir.z);
    if (this._fwd.lengthSq() < 1e-6) return;
    this._fwd.normalize();
    this._right.crossVectors(this._fwd, this._up).normalize();

    var dt = Math.min(delta || 16, 100) / 1000;
    var extraSpeed = Math.max(this.data.boost - this.data.normal, 0);
    var step = extraSpeed * dt;
    if (moveX !== 0 && moveZ !== 0) step *= Math.SQRT1_2;

    this._delta.set(0, 0, 0);
    this._delta.addScaledVector(this._fwd, moveZ * step);
    this._delta.addScaledVector(this._right, moveX * step);

    this.el.object3D.position.x += this._delta.x;
    this.el.object3D.position.z += this._delta.z;
  }
});

AFRAME.registerComponent("cursor-depth-fix", {
  schema: {
    defaultDistance: { type: "number", default: 1.0 },
    offset:         { type: "number", default: 0.015 },
    minDist:        { type: "number", default: 0.05 }
  },

  init: function () {
    this.raycaster  = new THREE.Raycaster();
    this.raycaster.far = 20;
    this._origin    = new THREE.Vector3();
    this._dir       = new THREE.Vector3();
    this._worldNml  = new THREE.Vector3();
    this._nmlMat    = new THREE.Matrix3();
    this._hooked    = false;
    this._roomObj   = null;
    this._diskObjs  = null;

    this._depthScale = 1;
    this._fuseScale  = 1;
    this._isFusing   = false;
    this._fuseStart  = 0;
    this._fuseTimeout = 2000;
    this._isLeaving  = false;
    this._leaveStart = 0;
    this._leaveDur   = 300;
    this._leaveFrom  = 1;

    var self = this;
    this.el.addEventListener("fusing", function () {
      self._isFusing  = true;
      self._isLeaving = false;
      self._fuseStart = performance.now();
    });
    this.el.addEventListener("mouseleave", function () {
      self._isFusing  = false;
      self._isLeaving = true;
      self._leaveStart = performance.now();
      self._leaveFrom  = self._fuseScale;
    });
    this.el.addEventListener("click", function () {
      self._isFusing  = false;
      self._isLeaving = false;
      self._fuseScale = 1;
    });
  },

  tock: function () {
    this._doUpdate();
    this._ensureHook();
  },

  _ensureHook: function () {
    if (this._hooked) return;
    var mesh = this.el.getObject3D("mesh");
    if (!mesh) return;
    var self = this;
    var origOnBefore = mesh.onBeforeRender;
    mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      if (origOnBefore) origOnBefore.call(this, renderer, scene, camera, geometry, material, group);
      self._doUpdate(camera);
      self.el.object3D.updateMatrixWorld(true);
      this.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, this.matrixWorld);
    };
    this._hooked = true;
  },

  _computeFuseScale: function () {
    var now = performance.now();
    if (this._isFusing) {
      var elapsed = now - this._fuseStart;
      var progress = Math.min(elapsed / this._fuseTimeout, 1);
      this._fuseScale = 1 - progress * 0.7;
    } else if (this._isLeaving) {
      var elapsed2 = now - this._leaveStart;
      var progress2 = Math.min(elapsed2 / this._leaveDur, 1);
      this._fuseScale = this._leaveFrom + (1 - this._leaveFrom) * progress2;
      if (progress2 >= 1) { this._isLeaving = false; this._fuseScale = 1; }
    }
    return this._fuseScale;
  },

  _doUpdate: function (camera) {
    if (!this._roomObj) {
      var room = document.querySelector("#room");
      if (room && room.getObject3D("mesh")) this._roomObj = room.object3D;
    }
    if (!this._roomObj) return;

    var cam = camera || this.el.sceneEl.camera;
    if (!cam) return;

    cam.updateMatrixWorld(true);
    cam.getWorldPosition(this._origin);
    cam.getWorldDirection(this._dir);

    if (!this._diskObjs || (performance.now() - (this._diskRefreshT || 0)) > 1000) {
      this._diskRefreshT = performance.now();
      this._diskObjs = [];
      var dEls = document.querySelectorAll("[smooth-teleport]");
      for (var k = 0; k < dEls.length; k++) {
        var dm = dEls[k].getObject3D("mesh");
        if (dm) this._diskObjs.push(dm);
      }
    }
    var targets = [this._roomObj].concat(this._diskObjs);

    this.raycaster.set(this._origin, this._dir);
    var hits = this.raycaster.intersectObjects(targets, true);

    var d = this.data.defaultDistance;
    var fuseS = this._computeFuseScale();
    var finalDist = d;

    if (hits.length > 0) {
      var hit = hits[0];
      var dynOff = this.data.offset;
      if (hit.face && hit.object) {
        this._nmlMat.getNormalMatrix(hit.object.matrixWorld);
        this._worldNml.copy(hit.face.normal).applyMatrix3(this._nmlMat).normalize();
        var cosA = Math.abs(this._worldNml.dot(this._dir));
        dynOff = this.data.offset / Math.max(cosA, 0.05);
        dynOff = Math.min(dynOff, 0.35);
      }
      var surfDist = hit.distance - dynOff;
      if (surfDist < this.data.minDist) surfDist = this.data.minDist;
      finalDist = Math.min(d, surfDist);
    }

    this.el.object3D.position.z = -finalDist;
    this._depthScale = finalDist / d;
    var fs = this._depthScale * fuseS;
    if (fs < 0.3) fs = 0.3;   // 最小缩放，防止看天花板/地面时游标消失
    this.el.object3D.scale.set(fs, fs, fs);
  }
});


/* === 瞬移点标记（仅用于让 teleport-manager 识别圆盘，不再用点击触发） === */
AFRAME.registerComponent("smooth-teleport", {
  schema: {
    target:    { type: "vec3",    default: { x: 0, y: 0, z: 0 } },
    useMarker: { type: "boolean", default: true }
  },
  init: function () { /* 纯标记，瞬移逻辑交给 teleport-manager 统一处理 */ }
});


/* === 瞬移管理器（注视选择 + 遮挡检测；反馈用准星缩放，不用进度环） === */
AFRAME.registerComponent("teleport-manager", {
  schema: {
    fuseDur:      { type: "number",  default: 2000 },  // 注视多久触发(ms)，需与准星缩放时长一致
    moveDur:      { type: "number",  default: 1200 },  // 平滑移动时长(ms)
    hideOccluded: { type: "boolean", default: true },  // 是否隐藏被墙真正挡住的圆盘
    nearShow:     { type: "number",  default: 3.0 },   // 小于该距离的圆盘永远显示(米)
    occMargin:    { type: "number",  default: 0.35 },  // 遮挡检测在圆盘前留出的余量(米)
    markScale:    { type: "number",  default: 0.97 },   // 所有瞬移标记的统一缩放
    markY:        { type: "number",  default: 0 }      // 所有瞬移标记的统一离地高度(米)
  },

  init: function () {
    this.disks       = [];
    this.diskMeshSet = new Set();
    this.roomModel   = null;

    this.ray    = new THREE.Raycaster();  this.ray.far = 20;
    this.occRay = new THREE.Raycaster();

    this.cursorEl    = null;
    this.gazeDisk    = null;
    this.gazeElapsed = 0;
    this.cooldown    = false;
    this.lastDisk    = null;        // 刚瞬移到的圆盘，需先移开视线才能再次触发

    this._camWP  = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._diskWP = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
    this._occAcc = 0;

    this.el.addEventListener("model-loaded", this.onModelLoaded.bind(this));
  },

  onModelLoaded: function () {
    this.roomModel = this.el.getObject3D("mesh") || null;
    this.collectDisks();
  },

  update: function () {
    // 参数变化（含运行时调试）时，对已收集的标记重新套用缩放/高度
    for (var i = 0; i < this.disks.length; i++) this.applyMarkTransform(this.disks[i].el);
  },

  applyMarkTransform: function (el) {
    var s = this.data.markScale;
    el.setAttribute("scale", s + " " + s + " " + s);
    var p = el.getAttribute("position");
    if (p) el.setAttribute("position", { x: p.x, y: this.data.markY, z: p.z });
  },

  collectDisks: function () {
    var self = this;
    if (!this._reCollect) this._reCollect = this.collectDisks.bind(this);
    this.disks = [];
    this.diskMeshSet = new Set();
    var els = document.querySelectorAll("[smooth-teleport]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var m = el.getObject3D("mesh");
      if (!m) {
        // GLB 模型异步加载，等其就绪后重新收集（同一绑定函数 + once，不会重复堆叠）
        el.addEventListener("model-loaded", this._reCollect, { once: true });
        el.addEventListener("loaded", this._reCollect, { once: true });
        continue;
      }
      this.disks.push({ el: el, mesh: m });
      this.applyMarkTransform(el);                       // 统一缩放/高度
      m.traverse(function (ch) { if (ch.isMesh) self.diskMeshSet.add(ch); });
    }
    console.log("[teleport-manager] 已注册标记:", this.disks.length, "/", els.length,
                "| markScale =", this.data.markScale, "| markY =", this.data.markY);
  },

  /* ---------- 准星缩放反馈（复用原 cursor 的 fusing / mouseleave 动画） ---------- */
  startGazeVisual: function () {
    if (!this.cursorEl) this.cursorEl = document.querySelector("[cursor]");
    if (this.cursorEl) this.cursorEl.emit("fusing");
  },
  endGazeVisual: function () {
    if (!this.cursorEl) this.cursorEl = document.querySelector("[cursor]");
    if (this.cursorEl) this.cursorEl.emit("mouseleave");
  },

  diskFromMesh: function (mesh) {
    for (var i = 0; i < this.disks.length; i++) {
      var dm = this.disks[i].mesh, found = (dm === mesh);
      if (!found) dm.traverse(function (ch) { if (ch === mesh) found = true; });
      if (found) return this.disks[i];
    }
    return null;
  },

  /* ---------- 只隐藏“真正被墙挡住”的圆盘；近处一律显示 ---------- */
  updateOcclusionVisibility: function () {
    if (!this.roomModel) return;
    for (var i = 0; i < this.disks.length; i++) {
      var d = this.disks[i];
      d.el.object3D.getWorldPosition(this._diskWP);
      this._diskWP.y += 0.05;
      this._tmpDir.subVectors(this._diskWP, this._camWP);
      var dist = this._tmpDir.length();

      // 近距离豁免：足够近的圆盘永远显示，避免斜看擦到地面被误判
      if (dist <= this.data.nearShow) { d.el.object3D.visible = true; continue; }

      this._tmpDir.normalize();
      this.occRay.set(this._camWP, this._tmpDir);
      this.occRay.far = dist - this.data.occMargin;     // 留足余量，忽略圆盘附近的地面/门槛
      if (this.occRay.far <= 0) { d.el.object3D.visible = true; continue; }

      var occluded = this.occRay.intersectObject(this.roomModel, true).length > 0;
      d.el.object3D.visible = !occluded;
    }
  },

  tick: function (time, delta) {
    if (!this.roomModel) return;
    if (!this.disks.length) { this.collectDisks(); if (!this.disks.length) return; }

    var camEl = document.querySelector("#cam");
    if (!camEl) return;
    var camObj = camEl.object3D;
    camObj.getWorldPosition(this._camWP);
    camObj.getWorldDirection(this._camDir);
    this._camDir.negate();

    // 节流隐藏被挡圆盘
    if (this.data.hideOccluded) {
      this._occAcc += (delta || 16);
      if (this._occAcc >= 180) { this._occAcc = 0; this.updateOcclusionVisibility(); }
    }

    if (this.cooldown) return;

    // 主射线：房间 + 圆盘，取最近命中（墙/门更近 => 圆盘被挡 => 不选中）
    var targets = [this.roomModel];
    for (var i = 0; i < this.disks.length; i++) targets.push(this.disks[i].mesh);
    this.ray.set(this._camWP, this._camDir);
    var hits = this.ray.intersectObjects(targets, true);

    var hitDisk = null;
    if (hits.length > 0 && this.diskMeshSet.has(hits[0].object)) {
      hitDisk = this.diskFromMesh(hits[0].object);
    }

    // 刚瞬移到的圆盘：先移开视线，否则忽略
    if (hitDisk && hitDisk === this.lastDisk) {
      if (this.gazeDisk) { this.gazeDisk = null; this.gazeElapsed = 0; this.endGazeVisual(); }
      return;
    }
    if (!hitDisk) this.lastDisk = null;

    if (hitDisk && hitDisk === this.gazeDisk) {
      // 持续注视：准星缩放由 cursor 动画自行完成，这里只计时
      this.gazeElapsed += (delta || 16);
      if (this.gazeElapsed >= this.data.fuseDur) {
        var target = hitDisk;
        this.gazeDisk = null; this.gazeElapsed = 0;
        this.doTeleport(target);
      }
    } else if (hitDisk) {
      // 新注视开始：触发准星缩放
      this.gazeDisk = hitDisk; this.gazeElapsed = 0;
      this.startGazeVisual();
    } else {
      // 视线离开圆盘：复位准星
      if (this.gazeDisk) { this.gazeDisk = null; this.gazeElapsed = 0; this.endGazeVisual(); }
    }
  },

  doTeleport: function (d) {
    var rig = document.querySelector("#rig");
    var camEl = document.querySelector("#cam");
    d.el.object3D.getWorldPosition(this._diskWP);

    // ===== 关键修复：移动会把偏移累加到“相机”的本地坐标，而瞬移只移动了“rig” =====
    // 相机是 rig 的子节点：相机世界坐标 = rig坐标 + 相机本地偏移。
    // 电脑上用 wasd-controls、手机模式下用摇杆，都会改变相机的本地 x/z。
    // 原代码直接把 rig 设到圆盘世界坐标，忽略了相机本地偏移，
    // 于是最终落点 = 圆盘 + 相机本地偏移 —— 手机上摇杆走得多，偏移就明显。
    // 这里减去相机本地 x/z，保证“眼睛”精确落在圆盘上（电脑/手机一致）。
    var cl = (camEl && camEl.object3D) ? camEl.object3D.position : { x: 0, z: 0 };
    var tx = this._diskWP.x - cl.x;
    var tz = this._diskWP.z - cl.z;
    var ty = rig.object3D.position.y;
    rig.removeAttribute("animation");
    rig.setAttribute("animation", {
      property: "position", to: tx + " " + ty + " " + tz,
      dur: this.data.moveDur, easing: "easeInOutQuad"
    });
    this.endGazeVisual();           // 复位准星
    this.lastDisk = d;
    this.cooldown = true;
    var self = this;
    setTimeout(function () { self.cooldown = false; }, this.data.moveDur + 200);
  }
});


/* === 1. 自动居中 === */
AFRAME.registerComponent("center-rig-on-model", {
  schema: { eyeHeight: { type: "number", default: 2.0 } },
  init: function () {
    var el = this.el, data = this.data;
    el.addEventListener("model-loaded", function () {
      var box = new THREE.Box3().setFromObject(el.object3D);
      var center = box.getCenter(new THREE.Vector3());
      var rig = document.querySelector("#rig");
      rig.setAttribute("position", {
        x: center.x, y: box.min.y + data.eyeHeight, z: center.z
      });
    });
  }
});

/* === 2. 碰撞 === */
AFRAME.registerComponent("simple-collision", {
  schema: { radius: { type: "number", default: 0.2 }, rays: { type: "int", default: 12 } },
  init: function () {
    this.raycaster = new THREE.Raycaster();
    this.prevPos = new THREE.Vector3();
    this.worldPos = new THREE.Vector3();
    this.directions = [];
    for (var i = 0; i < this.data.rays; i++) {
      var a = (i / this.data.rays) * Math.PI * 2;
      this.directions.push(new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
    }
    this.ready = false;
  },
  tick: function () {
    var room = document.querySelector("#room");
    if (!room || !room.object3D) return;
    var camPos = this.el.object3D.position;
    if (!this.ready) { this.prevPos.copy(camPos); this.ready = true; return; }
    this.el.object3D.getWorldPosition(this.worldPos);
    var blocked = false, r = this.data.radius;
    var hs = [this.worldPos.y - 0.5, this.worldPos.y - 0.15, this.worldPos.y + 0.2];
    for (var h = 0; h < hs.length && !blocked; h++) {
      var o = new THREE.Vector3(this.worldPos.x, hs[h], this.worldPos.z);
      for (var i = 0; i < this.directions.length; i++) {
        this.raycaster.set(o, this.directions[i]);
        this.raycaster.far = r;
        if (this.raycaster.intersectObject(room.object3D, true).length) {
          blocked = true; break;
        }
      }
    }
    if (blocked) camPos.copy(this.prevPos);
    else this.prevPos.copy(camPos);
  }
});

/* === 3. 门管理器（注视2秒直接开关门） === */
AFRAME.registerComponent("door-manager", {
  init: function () {
    this.doors = {};
    this.mixer = null;
    this.clock = new THREE.Clock();

    this.ray = new THREE.Raycaster();
    this.ray.far = 15;
    this.gazeDoor = null;
    this.gazeElapsed = 0;
    this.fuseDur = 2000;
    this.cooldown = false;

    this.meshToDoor = new Map();
    this.roomModel = null;

    this.fuseRing = null;
    this.fuseRingBg = null;

    this._camWP = new THREE.Vector3();
    this._camDir = new THREE.Vector3();

    this.el.addEventListener("model-loaded", this.onModelLoaded.bind(this));
  },

  createFuseRing: function () {
    var cam = document.querySelector("#cam").object3D;

    var bgGeo = new THREE.RingGeometry(0.019, 0.03, 48);
    var bgMat = new THREE.MeshBasicMaterial({
      color: 0x555555, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, depthTest: false
    });
    this.fuseRingBg = new THREE.Mesh(bgGeo, bgMat);
    this.fuseRingBg.renderOrder = 9998;
    this.fuseRingBg.visible = false;
    cam.add(this.fuseRingBg);

    var geo = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2, 0.001);
    var mat = new THREE.MeshBasicMaterial({
      color: 0x00ff88, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthTest: false
    });
    this.fuseRing = new THREE.Mesh(geo, mat);
    this.fuseRing.renderOrder = 9999;
    this.fuseRing.visible = false;
    cam.add(this.fuseRing);
  },

  syncFuseRingPosition: function () {
    var cursorEl = document.querySelector("[cursor]");
    if (!cursorEl) return;
    var cz = cursorEl.object3D.position.z;
    var s = Math.abs(cz);
    if (this.fuseRingBg) {
      this.fuseRingBg.position.set(0, 0, cz);
      this.fuseRingBg.scale.set(s, s, s);
    }
    if (this.fuseRing) {
      this.fuseRing.position.set(0, 0, cz + 0.001);
      this.fuseRing.scale.set(s, s, s);
    }
  },

  showFuseRing: function () {
    if (!this.fuseRing) this.createFuseRing();
    this.fuseRingBg.visible = true;
    this.fuseRing.visible = true;
    this.syncFuseRingPosition();
    this.updateFuseRing(0);
  },

  hideFuseRing: function () {
    if (this.fuseRingBg) this.fuseRingBg.visible = false;
    if (this.fuseRing) this.fuseRing.visible = false;
  },

  updateFuseRing: function (pct) {
    if (!this.fuseRing) return;
    pct = Math.min(Math.max(pct, 0), 1);
    var theta = pct * Math.PI * 2;
    if (theta < 0.001) theta = 0.001;
    var newGeo = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2, theta);
    this.fuseRing.geometry.dispose();
    this.fuseRing.geometry = newGeo;

    if (this.gazeDoor && this.doors[this.gazeDoor]) {
      var st = this.doors[this.gazeDoor].state;
      if (st === "open") {
        this.fuseRing.material.color.setRGB(1.0, 0.6 - pct * 0.4, 0.2);
      } else {
        this.fuseRing.material.color.setRGB(1.0 - pct * 0.7, 1.0, 1.0 - pct * 0.5);
      }
    } else {
      this.fuseRing.material.color.setRGB(1.0 - pct * 0.7, 1.0, 1.0 - pct * 0.5);
    }

    this.syncFuseRingPosition();
  },

  onModelLoaded: function () {
    var model = this.el.getObject3D("mesh");
    if (!model) return;
    this.roomModel = model;

    var anims = model.animations || [];
    if (!anims.length) return;

    this.mixer = new THREE.AnimationMixer(model);
    this.mixer.addEventListener("finished", this.onAnimFinished.bind(this));

    var self = this;

    for (var c = 0; c < anims.length; c++) {
      var clip = anims[c], cn = clip.name;
      if (cn.toLowerCase().indexOf("door") === -1) continue;

      var dn = cn;
      if (dn.indexOf(".Anim") !== -1) dn = dn.substring(0, dn.lastIndexOf(".Anim"));
      else if (dn.indexOf(" Anim") !== -1) dn = dn.substring(0, dn.lastIndexOf(" Anim"));
      dn = dn.trim();

      var obj = null;
      model.traverse(function (ch) { if (!obj && ch.name === dn) obj = ch; });
      if (!obj) {
        var cl = dn.replace(/\s/g, "");
        model.traverse(function (ch) {
          if (!obj && ch.name.replace(/\s/g, "") === cl) obj = ch;
        });
      }
      if (!obj) {
        for (var t = 0; t < clip.tracks.length; t++) {
          var tn = clip.tracks[t].name, di = tn.lastIndexOf(".");
          if (di === -1) continue;
          var pp = tn.substring(di + 1);
          if (pp === "position" || pp === "quaternion" || pp === "scale") {
            var np = tn.substring(0, di);
            model.traverse(function (ch) { if (!obj && ch.name === np) obj = ch; });
            if (obj) break;
          }
        }
      }
      if (!obj) continue;
      var rk = obj.name;
      if (self.doors[rk]) continue;

      var action = self.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;
      action.stop();

      var meshes = [];
      obj.traverse(function (ch) {
        if (ch.isMesh) {
          meshes.push(ch);
          self.meshToDoor.set(ch, rk);
        }
      });

      self.doors[rk] = {
        mesh: obj,
        meshes: meshes,
        clip: clip,
        action: action,
        state: "closed"
      };
      console.log("🚪 注册:", rk, "mesh:", meshes.map(function (m) { return m.name; }));
    }
    console.log("✅ 门数量:", Object.keys(self.doors).length);
  },

  tick: function (time, delta) {
    if (this.mixer) this.mixer.update(this.clock.getDelta());
    if (this.cooldown) return;
    if (!this.roomModel) return;

    var cam = document.querySelector("#cam");
    if (!cam) return;
    var camObj = cam.object3D;
    camObj.getWorldPosition(this._camWP);
    camObj.getWorldDirection(this._camDir);
    this._camDir.negate();

    this.ray.set(this._camWP, this._camDir);
    var hits = this.ray.intersectObject(this.roomModel, true);

    var hitKey = null;
    if (hits.length > 0) {
      var firstHit = hits[0].object;
      hitKey = this.meshToDoor.get(firstHit) || null;
      if (hitKey) {
        var ds = this.doors[hitKey].state;
        if (ds === "opening" || ds === "closing") hitKey = null;
      }
    }

    if (hitKey && hitKey === this.gazeDoor) {
      this.gazeElapsed += (delta || 16);
      this.updateFuseRing(this.gazeElapsed / this.fuseDur);
      if (this.gazeElapsed >= this.fuseDur) {
        this.hideFuseRing();
        this.gazeDoor = null;
        this.gazeElapsed = 0;
        this.executeDoor(hitKey);
      }
    } else if (hitKey) {
      this.gazeDoor = hitKey;
      this.gazeElapsed = 0;
      this.showFuseRing();
    } else {
      if (this.gazeDoor) {
        this.gazeDoor = null;
        this.gazeElapsed = 0;
        this.hideFuseRing();
      }
    }
  },

  onAnimFinished: function (e) {
    var self = this;
    for (var k in this.doors) {
      var d = this.doors[k];
      if (d.action === e.action) {
        if (d.state === "opening") d.state = "open";
        else if (d.state === "closing") d.state = "closed";
        console.log("🚪", k, "→", d.state);
        break;
      }
    }
    this.cooldown = true;
    setTimeout(function () { self.cooldown = false; }, 800);
  },

  executeDoor: function (k) {
    var d = this.doors[k];
    if (!d) return;

    if (d.state === "closed") {
      console.log("🔓 开门:", k);
      this.playDoorOpen(k);
    } else if (d.state === "open") {
      console.log("🔒 关门:", k);
      this.playDoorClose(k);
    }

    var self = this;
    this.cooldown = true;
    setTimeout(function () { self.cooldown = false; }, 800);
  },

  playDoorOpen: function (k) {
    var d = this.doors[k]; if (!d) return;
    var a = d.action;
    a.paused = false; a.enabled = true;
    a.clampWhenFinished = true;
    a.setLoop(THREE.LoopOnce);
    a.timeScale = 1; a.time = 0;
    a.reset(); a.play();
    d.state = "opening";
  },

  playDoorClose: function (k) {
    var d = this.doors[k]; if (!d) return;
    var a = d.action, dur = d.clip.duration;
    a.paused = false; a.enabled = true;
    a.clampWhenFinished = true;
    a.setLoop(THREE.LoopOnce);
    a.timeScale = -1; a.time = dur;
    a.reset(); a.time = dur; a.play();
    d.state = "closing";
  }
});

/* ============================================================
   道具管理器（注视2秒触发 oven / can / cupboard 动画）
   识别动画名中含 "oven"、"can"、"cupboard" 的 clip（大小写不敏感），
   逻辑与 door-manager 完全一致：LoopOnce 正放/反放切换开关状态。
   复用 door-manager 里同一套绿色进度环 UI（不新建，共享一个环）。
   ============================================================ */
AFRAME.registerComponent("prop-manager", {
  // 需要拦截的关键词 → emoji 前缀（仅用于 console 日志）
  KEYWORDS: { oven: "🔥", can: "🗑️", cupboard: "🗄️" },

  init: function () {
    this.props      = {};          // key → { mesh, meshes, clip, action, state }
    this.meshToProp = new Map();   // THREE.Mesh → propKey
    this.mixer      = null;
    this.clock      = new THREE.Clock();
    this.roomModel  = null;

    this.ray         = new THREE.Raycaster();
    this.ray.far     = 10;          // 道具比门近，缩短射程避免误触
    this.gazeProp    = null;
    this.gazeElapsed = 0;
    this.fuseDur     = 2000;
    this.cooldown    = false;

    this.fuseRing    = null;
    this.fuseRingBg  = null;

    this._camWP  = new THREE.Vector3();
    this._camDir = new THREE.Vector3();

    this.el.addEventListener("model-loaded", this.onModelLoaded.bind(this));
  },

  /* -------- 进度环（与 door-manager 同样的样式，独立实例） -------- */
  createFuseRing: function () {
    var cam = document.querySelector("#cam").object3D;

    var bgGeo = new THREE.RingGeometry(0.019, 0.03, 48);
    var bgMat = new THREE.MeshBasicMaterial({
      color: 0x555555, transparent: true, opacity: 0.4,
      side: THREE.DoubleSide, depthTest: false
    });
    this.fuseRingBg = new THREE.Mesh(bgGeo, bgMat);
    this.fuseRingBg.renderOrder = 9996;
    this.fuseRingBg.visible = false;
    cam.add(this.fuseRingBg);

    var geo = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2, 0.001);
    var mat = new THREE.MeshBasicMaterial({
      color: 0xffaa00, transparent: true, opacity: 0.9,
      side: THREE.DoubleSide, depthTest: false
    });
    this.fuseRing = new THREE.Mesh(geo, mat);
    this.fuseRing.renderOrder = 9997;
    this.fuseRing.visible = false;
    cam.add(this.fuseRing);
  },

  syncFuseRingPosition: function () {
    var cursorEl = document.querySelector("[cursor]");
    if (!cursorEl) return;
    var cz = cursorEl.object3D.position.z;
    var s  = Math.abs(cz);
    if (this.fuseRingBg) { this.fuseRingBg.position.set(0, 0, cz);         this.fuseRingBg.scale.set(s, s, s); }
    if (this.fuseRing)   { this.fuseRing.position.set(0, 0, cz + 0.001);   this.fuseRing.scale.set(s, s, s); }
  },

  showFuseRing: function () {
    if (!this.fuseRing) this.createFuseRing();
    this.fuseRingBg.visible = true;
    this.fuseRing.visible   = true;
    this.syncFuseRingPosition();
    this.updateFuseRing(0);
  },

  hideFuseRing: function () {
    if (this.fuseRingBg) this.fuseRingBg.visible = false;
    if (this.fuseRing)   this.fuseRing.visible   = false;
  },

  updateFuseRing: function (pct) {
    if (!this.fuseRing) return;
    pct = Math.min(Math.max(pct, 0), 1);
    var theta = pct * Math.PI * 2; if (theta < 0.001) theta = 0.001;
    var newGeo = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2, theta);
    this.fuseRing.geometry.dispose();
    this.fuseRing.geometry = newGeo;
    // 橙色 → 红色（关闭时）；橙色 → 黄色（打开时）
    if (this.gazeProp && this.props[this.gazeProp]) {
      var st = this.props[this.gazeProp].state;
      if (st === "open") this.fuseRing.material.color.setRGB(1.0, 0.4 + (1 - pct) * 0.26, 0.0);
      else               this.fuseRing.material.color.setRGB(1.0, 0.67 + pct * 0.2, 0.0 + pct * 0.2);
    }
    this.syncFuseRingPosition();
  },

  /* -------- 模型载入：扫描 oven / can / cupboard 动画 -------- */
  onModelLoaded: function () {
    var model = this.el.getObject3D("mesh");
    if (!model) return;
    this.roomModel = model;

    var anims = model.animations || [];
    if (!anims.length) { console.warn("[prop-manager] 模型无动画"); return; }

    this.mixer = new THREE.AnimationMixer(model);
    this.mixer.addEventListener("finished", this.onAnimFinished.bind(this));

    var self = this;
    var KEYWORDS = Object.keys(this.KEYWORDS);

    // 打印所有动画名，便于调试
    console.log("[prop-manager] 全部动画:");
    for (var d = 0; d < anims.length; d++) console.log("  ", anims[d].name);

    // 打印所有节点名，便于调试
    console.log("[prop-manager] 全部节点:");
    model.traverse(function(ch){ if(ch.name) console.log("  ", ch.name, "isMesh:", ch.isMesh); });

    for (var c = 0; c < anims.length; c++) {
      var clip = anims[c], cn = clip.name, cnL = cn.toLowerCase();

      // 只处理匹配关键词的动画
      var matched = false;
      for (var ki = 0; ki < KEYWORDS.length; ki++) {
        if (cnL.indexOf(KEYWORDS[ki]) !== -1) { matched = true; break; }
      }
      if (!matched) continue;

      // 剥离 ".Anim" / " Anim" 后缀，得到物体名
      var dn = cn;
      if (dn.indexOf(".Anim") !== -1)      dn = dn.substring(0, dn.lastIndexOf(".Anim"));
      else if (dn.indexOf(" Anim") !== -1) dn = dn.substring(0, dn.lastIndexOf(" Anim"));
      dn = dn.trim();

      // 从 track 名提取所有涉及的节点名（最可靠）
      var trackNodeNames = [];
      for (var t = 0; t < clip.tracks.length; t++) {
        var tn = clip.tracks[t].name;
        var di = tn.lastIndexOf(".");
        if (di === -1) continue;
        var np = tn.substring(0, di);
        if (trackNodeNames.indexOf(np) === -1) trackNodeNames.push(np);
      }
      console.log("[prop-manager] clip:", cn, "→ dn:", dn, "| track nodes:", trackNodeNames);

      // 找根节点：精确名 → 忽略空格 → track 名反查
      var obj = null;
      model.traverse(function (ch) { if (!obj && ch.name === dn) obj = ch; });
      if (!obj) {
        var cl = dn.replace(/\s/g, "");
        model.traverse(function (ch) {
          if (!obj && ch.name.replace(/\s/g, "") === cl) obj = ch;
        });
      }
      if (!obj) {
        for (var ti = 0; ti < trackNodeNames.length; ti++) {
          var tnn = trackNodeNames[ti];
          model.traverse(function (ch) { if (!obj && ch.name === tnn) obj = ch; });
          if (obj) break;
        }
      }
      if (!obj) { console.warn("[prop-manager] ❌ 找不到节点:", dn, "track nodes:", trackNodeNames); continue; }

      var rk = obj.name;
      if (self.props[rk]) continue;

      var action = self.mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce);
      action.clampWhenFinished = true;
      action.stop();

      // 收集 Mesh：
      // 策略1：节点自身子树
      // 策略2：track 节点名（名字可能与场景节点名不同，做模糊前缀匹配）
      // 策略3：无论如何，把整个 roomModel 里所有 isMesh 且在动画影响范围内的都收集
      var meshes = [];
      function addMesh(m) {
        if (meshes.indexOf(m) === -1) { meshes.push(m); self.meshToProp.set(m, rk); }
      }

      // 策略1：节点子树
      obj.traverse(function (ch) { if (ch.isMesh) addMesh(ch); });
      if (obj.isMesh) addMesh(obj);

      // 策略2：track 节点名 精确 + 前缀模糊匹配
      if (meshes.length === 0) {
        console.warn("[prop-manager] ⚠️ 节点", rk, "子树无 Mesh，尝试 track 节点名匹配");
        model.traverse(function (ch) {
          for (var ti2 = 0; ti2 < trackNodeNames.length; ti2++) {
            var tnn = trackNodeNames[ti2];
            // 精确匹配 或 前缀相同（如 mesh_463.001 匹配 mesh_463.003）
            var prefix = tnn.replace(/\.\d+$/, '');
            var chPrefix = ch.name.replace(/\.\d+$/, '');
            if (ch.name === tnn || (prefix.length > 3 && chPrefix === prefix)) {
              if (ch.isMesh) addMesh(ch);
              ch.traverse(function(c){ if (c.isMesh) addMesh(c); });
            }
          }
        });
      }

      // 策略3：如果还是空，把 obj 的所有祖先平级的同名前缀 Mesh 都收进来
      if (meshes.length === 0) {
        console.warn("[prop-manager] ⚠️ track 匹配仍无 Mesh，尝试全模型前缀匹配 rk:", rk);
        var rkPrefix = rk.replace(/\.\d+$/, '');
        model.traverse(function (ch) {
          if (ch.isMesh && ch.name.replace(/\.\d+$/, '') === rkPrefix) addMesh(ch);
          // 也把直接父节点名匹配的子树加进来
          if (ch.name === rk || ch.name === dn) {
            ch.traverse(function(c){ if(c.isMesh) addMesh(c); });
          }
        });
      }

      var tag = "📦";
      for (var ki2 = 0; ki2 < KEYWORDS.length; ki2++) {
        if (cnL.indexOf(KEYWORDS[ki2]) !== -1) { tag = self.KEYWORDS[KEYWORDS[ki2]]; break; }
      }

      self.props[rk] = { mesh: obj, meshes: meshes, clip: clip, action: action, state: "closed", tag: tag };
      console.log(tag + " 注册:", rk, "| clip:", cn, "| Mesh 数:", meshes.length,
                  meshes.map(function(m){ return m.name; }));
    }
    console.log("✅ [prop-manager] 道具数量:", Object.keys(self.props).length,
                "| meshToProp 条数:", self.meshToProp.size);
  },

  /* -------- 每帧：注视检测 -------- */
  tick: function (time, delta) {
    if (this.mixer) this.mixer.update(this.clock.getDelta());
    if (this.cooldown || !this.roomModel) return;

    var cam = document.querySelector("#cam");
    if (!cam) return;
    var camObj = cam.object3D;
    camObj.getWorldPosition(this._camWP);
    camObj.getWorldDirection(this._camDir);
    this._camDir.negate();

    this.ray.set(this._camWP, this._camDir);
    var hits = this.ray.intersectObject(this.roomModel, true);

    // 遍历所有命中，跳过不在 meshToProp 里的（如正在携带的 bread）
    var hitKey = null;
    for (var hi = 0; hi < hits.length; hi++) {
      var candidate = this.meshToProp.get(hits[hi].object) || null;
      if (!candidate) continue;
      var st = this.props[candidate].state;
      if (st === "opening" || st === "closing") continue;
      hitKey = candidate;
      break;
    }

    if (hitKey && hitKey === this.gazeProp) {
      this.gazeElapsed += (delta || 16);
      this.updateFuseRing(this.gazeElapsed / this.fuseDur);
      if (this.gazeElapsed >= this.fuseDur) {
        this.hideFuseRing();
        var key = hitKey;
        this.gazeProp = null; this.gazeElapsed = 0;
        this.executeProp(key);
      }
    } else if (hitKey) {
      this.gazeProp = hitKey; this.gazeElapsed = 0;
      this.showFuseRing();
    } else {
      if (this.gazeProp) { this.gazeProp = null; this.gazeElapsed = 0; this.hideFuseRing(); }
    }
  },

  onAnimFinished: function (e) {
    var self = this;
    for (var k in this.props) {
      var p = this.props[k];
      if (p.action === e.action) {
        if (p.state === "opening") p.state = "open";
        else if (p.state === "closing") p.state = "closed";
        console.log(p.tag, k, "→", p.state);
        break;
      }
    }
    this.cooldown = true;
    setTimeout(function () { self.cooldown = false; }, 800);
  },

  executeProp: function (k) {
    var p = this.props[k]; if (!p) return;
    if (p.state === "closed")      this.playOpen(k);
    else if (p.state === "open")   this.playClose(k);
    var self = this;
    this.cooldown = true;
    setTimeout(function () { self.cooldown = false; }, 800);
  },

  playOpen: function (k) {
    var p = this.props[k]; if (!p) return;
    var a = p.action;
    a.paused = false; a.enabled = true;
    a.clampWhenFinished = true; a.setLoop(THREE.LoopOnce);
    a.timeScale = 1; a.time = 0;
    a.reset(); a.play();
    p.state = "opening";
    console.log(p.tag, "开启:", k);
  },

  playClose: function (k) {
    var p = this.props[k]; if (!p) return;
    var a = p.action, dur = p.clip.duration;
    a.paused = false; a.enabled = true;
    a.clampWhenFinished = true; a.setLoop(THREE.LoopOnce);
    a.timeScale = -1; a.time = dur;
    a.reset(); a.time = dur; a.play();
    p.state = "closing";
    console.log(p.tag, "关闭:", k);
  }
});

/* ============================================================
   pickup-manager — 通用拾取/放下组件
   
   用法：在 #room 上添加属性 pickup-manager
   在需要可拾取的物体节点上注册（通过 registerItem 接口）
   
   接口：
     window.PickupManager.register(nodeName, opts)
       nodeName : GLB 节点名（字符串）
       opts.fuseDur     : 凝视触发时长(ms)，默认 2000
       opts.carryDist   : 持物距准星距离(m)，默认 0.55
       opts.carryOffsetY: 持物垂直偏移(m)，默认 -0.12
       opts.dropSurface : 可放置面层级 true/false，默认 true
   
   状态机（每个物体独立）：
     idle → [凝视2s] → carrying → [凝视HUD放下按钮1.5s] → dropping → idle
   
   穿模解决：持物时用射线检测前方障碍，
            若物体与相机之间有遮挡则缩短持物距离
   ============================================================ */
AFRAME.registerComponent("pickup-manager", {
  schema: {
    fuseDur:      { type: "number", default: 2000  },  // 凝视拾起时长(ms)
    carryDist:    { type: "number", default: 0.55  },  // 持物距相机距离(m)
    carryOffsetY: { type: "number", default: -0.12 },  // 垂直偏移(m)
    lerpSpeed:    { type: "number", default: 12    },  // 跟随平滑度
    gravity:      { type: "number", default: 9.8   },  // 重力加速度(m/s²)
    groundY:      { type: "number", default: 0.0   }   // 地面 Y（物体落地停止高度）
  },

  init: function () {
    this.roomModel  = null;
    this.items      = {};          // nodeName → item
    this.meshToItem = new Map();
    this.heldItem   = null;

    // 自由落体状态
    this._falling     = false;
    this._velY        = 0;        // 当前竖直速度(m/s)

    // 多方向穿模检测射线（持物时从物体向6个方向探测）
    this._probeRays   = [];
    var dirs = [
      new THREE.Vector3( 1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3( 0, 1, 0), new THREE.Vector3( 0,-1, 0),
      new THREE.Vector3( 0, 0, 1), new THREE.Vector3( 0, 0,-1)
    ];
    for (var di = 0; di < dirs.length; di++) {
      var r = new THREE.Raycaster();
      r.far = 0.25;  // 物体半径余量
      this._probeRays.push({ ray: r, dir: dirs[di] });
    }

    // 视线穿模检测（相机 → 目标点）
    this._clipRay = new THREE.Raycaster();

    // 主射线
    this.ray = new THREE.Raycaster();
    this.ray.far = 8;

    // 复用向量
    this._camWP     = new THREE.Vector3();
    this._camDir    = new THREE.Vector3();
    this._targetWP  = new THREE.Vector3();
    this._curWP     = new THREE.Vector3();
    this._objWP     = new THREE.Vector3();
    this._invParent = new THREE.Matrix4();
    this._pushback  = new THREE.Vector3();

    // 进度环（拾取用，挂在相机）
    this._pickRing   = null;
    this._pickRingBg = null;

    this._pendingRegs = [];

    this.el.addEventListener("model-loaded", this.onModelLoaded.bind(this));

    // 全局注册接口
    var self = this;
    window.PickupManager = {
      register: function(name, opts) {
        if (self.roomModel) self._registerItem(name, opts || {});
        else self._pendingRegs.push({ name: name, opts: opts || {} });
      }
    };
  },

  /* ── 模型载入 ── */
  onModelLoaded: function () {
    var model = this.el.getObject3D("mesh");
    if (!model) return;
    this.roomModel = model;
    for (var i = 0; i < this._pendingRegs.length; i++) {
      this._registerItem(this._pendingRegs[i].name, this._pendingRegs[i].opts);
    }
    this._pendingRegs = [];
  },

  _registerItem: function (nodeName, opts) {
    var self = this, node = null;
    this.roomModel.traverse(function(ch) {
      if (!node && ch.name === nodeName) node = ch;
    });
    if (!node) { console.warn("[pickup] 找不到节点:", nodeName); return; }

    var meshes = new Set();
    node.traverse(function(ch) { if (ch.isMesh) meshes.add(ch); });
    if (node.isMesh) meshes.add(node);
    if (!meshes.size) { console.warn("[pickup] 节点无 Mesh:", nodeName); return; }

    var item = {
      name:         nodeName,
      node:         node,
      meshes:       meshes,
      state:        "idle",   // idle | fusing | carrying | falling
      gazeElapsed:  0,
      fuseDur:      opts.fuseDur      !== undefined ? opts.fuseDur      : this.data.fuseDur,
      carryDist:    opts.carryDist    !== undefined ? opts.carryDist    : this.data.carryDist,
      carryOffsetY: opts.carryOffsetY !== undefined ? opts.carryOffsetY : this.data.carryOffsetY,
      radius:       opts.radius       !== undefined ? opts.radius       : 0.18  // 碰撞半径(m)
    };

    this.items[nodeName] = item;
    meshes.forEach(function(m) { self.meshToItem.set(m, item); });
    console.log("[pickup] ✅ 注册:", nodeName, "Mesh:", meshes.size);
  },

  /* ── 进度环（挂相机，跟准星） ── */
  _ensureRings: function () {
    if (this._pickRing) return;
    var cam = document.querySelector("#cam").object3D;

    this._pickRingBg = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48),
      new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true,
        opacity: 0.35, side: THREE.DoubleSide, depthTest: false })
    );
    this._pickRingBg.renderOrder = 9988;
    this._pickRingBg.visible = false;
    cam.add(this._pickRingBg);

    this._pickRing = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI/2, 0.001),
      new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true,
        opacity: 0.95, side: THREE.DoubleSide, depthTest: false })
    );
    this._pickRing.renderOrder = 9989;
    this._pickRing.visible = false;
    cam.add(this._pickRing);
  },

  _syncPickRing: function () {
    var ce = document.querySelector("[cursor]");
    if (!ce || !this._pickRing) return;
    var cz = ce.object3D.position.z, s = Math.abs(cz);
    this._pickRingBg.position.set(0, 0, cz);       this._pickRingBg.scale.set(s,s,s);
    this._pickRing.position.set(0, 0, cz + 0.001); this._pickRing.scale.set(s,s,s);
  },

  _setPickRing: function (pct) {
    this._ensureRings();
    if (pct <= 0) {
      this._pickRingBg.visible = false;
      this._pickRing.visible   = false;
      return;
    }
    this._pickRingBg.visible = true;
    this._pickRing.visible   = true;
    pct = Math.min(pct, 1);
    var ng = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI/2,
                                    Math.max(pct * Math.PI * 2, 0.001));
    this._pickRing.geometry.dispose();
    this._pickRing.geometry = ng;
    this._syncPickRing();
  },

  /* ══════════════════════════════════════════════════
     穿模防护 — 两层：
     1. 视线层：相机→目标点之间有遮挡 → 缩短持物距离
     2. 物体层：物体当前位置向6方向探测 → pushback
  ══════════════════════════════════════════════════ */
  _safeCarryDist: function (item) {
    var maxDist = item.carryDist;
    this._clipRay.set(this._camWP, this._camDir);
    this._clipRay.far = maxDist + 0.3;
    var hits = this._clipRay.intersectObject(this.roomModel, true);
    for (var i = 0; i < hits.length; i++) {
      if (item.meshes.has(hits[i].object)) continue;
      var safe = hits[i].distance - 0.09;
      if (safe < 0.12) safe = 0.12;
      if (safe < maxDist) maxDist = safe;
      break;
    }
    return maxDist;
  },

  // 物体当前世界坐标 wp，向6方向探测，返回需要推开的 offset
  _computePushback: function (item, wp) {
    this._pushback.set(0, 0, 0);
    for (var i = 0; i < this._probeRays.length; i++) {
      var pr = this._probeRays[i];
      pr.ray.set(wp, pr.dir);
      var hits = pr.ray.intersectObject(this.roomModel, true);
      for (var j = 0; j < hits.length; j++) {
        if (item.meshes.has(hits[j].object)) continue;
        // 穿入深度 = radius - distance
        var penetration = item.radius - hits[j].distance;
        if (penetration > 0) {
          // 沿反方向推回
          this._pushback.addScaledVector(pr.dir, -penetration);
        }
        break;
      }
    }
    return this._pushback;
  },

  /* ── 拾起 ── */
  _pickup: function (item) {
    if (this.heldItem) return;
    item.meshes.forEach(function(m) { m.raycast = function(){}; });
    item.state  = "carrying";
    this.heldItem = item;
    this._falling = false;
    this._velY    = 0;
    console.log("[pickup] ✋", item.name);
  },

  /* ── 开始自由落体 ── */
  _startDrop: function (item) {
    if (!item || item.state !== "carrying") return;
    item.state    = "falling";
    this._falling = true;
    this._velY    = 0;   // 初速度为0，自然下落
    this.heldItem = null;
    // 恢复 raycast
    item.meshes.forEach(function(m) { delete m.raycast; });
    this._setPickRing(0);
    console.log("[pickup] 🪂 放下:", item.name);
  },

  /* ── 落地：停止 ── */
  _land: function (item) {
    item.state    = "idle";
    this._falling = false;
    this._velY    = 0;
    item.node.getWorldPosition(item.origWP);
    console.log("[pickup] 🟢 落地:", item.name);
  },

  /* ══════════════════════════════════════════════════
     tick
  ══════════════════════════════════════════════════ */
  tick: function (time, delta) {
    if (!this.roomModel) return;
    var dt = Math.min((delta || 16) / 1000, 0.05);  // 秒，限制最大步长防穿地

    var cam = document.querySelector("#cam");
    if (!cam) return;
    cam.object3D.getWorldPosition(this._camWP);
    cam.object3D.getWorldDirection(this._camDir);
    this._camDir.negate();

    /* ── 自由落体（falling state） ── */
    for (var key in this.items) {
      var fit = this.items[key];
      if (fit.state !== "falling") continue;

      // 重力加速
      this._velY -= this.data.gravity * dt;

      fit.node.getWorldPosition(this._objWP);
      var newWP = this._objWP.clone();
      newWP.y += this._velY * dt;

      // 下方碰撞检测（向 -Y 方向射线）
      var downRay = new THREE.Raycaster(this._objWP, new THREE.Vector3(0,-1,0));
      downRay.far = Math.abs(this._velY * dt) + 0.05;
      var downHits = downRay.intersectObject(this.roomModel, true);
      var landed = false;
      for (var dh = 0; dh < downHits.length; dh++) {
        if (fit.meshes.has(downHits[dh].object)) continue;
        // 落到表面上方 0.02m
        newWP.y = downHits[dh].point.y + 0.02;
        landed = true;
        break;
      }

      // 全方向 pushback 防穿其他模型侧面
      var pb = this._computePushback(fit, newWP);
      newWP.add(pb);

      // 写回本地坐标
      var fp = fit.node.parent;
      if (fp) {
        fp.updateMatrixWorld(true);
        this._invParent.copy(fp.matrixWorld).invert();
        fit.node.position.copy(newWP.clone().applyMatrix4(this._invParent));
      }

      if (landed) this._land(fit);
    }

    this._clipRay.set(this._camWP, this._camDir);
    this.ray.set(this._camWP, this._camDir);

    /* ── carrying：持物跟随 + 穿模防护 ── */
    if (this.heldItem && this.heldItem.state === "carrying") {
      var held = this.heldItem;

      // 1. 视线穿模：安全距离
      var safeDist = this._safeCarryDist(held);
      this._targetWP.copy(this._camWP).addScaledVector(this._camDir, safeDist);
      this._targetWP.y += held.carryOffsetY;

      // 2. Lerp 到目标
      held.node.getWorldPosition(this._curWP);
      var t = Math.min(dt * this.data.lerpSpeed, 1);
      var nextWP = this._curWP.clone().lerp(this._targetWP, t);

      // 3. 物体6方向 pushback 防穿侧面/顶面/底面
      var pb2 = this._computePushback(held, nextWP);
      nextWP.add(pb2);

      var hp = held.node.parent;
      if (hp) {
        hp.updateMatrixWorld(true);
        this._invParent.copy(hp.matrixWorld).invert();
        held.node.position.copy(nextWP.clone().applyMatrix4(this._invParent));
      }
      return; // 持物时不检测新拾取
    }

    /* ── idle：凝视检测拾取 ── */
    var hits = this.ray.intersectObject(this.roomModel, true);
    var gazed = null;
    for (var hi = 0; hi < hits.length; hi++) {
      var cand = this.meshToItem.get(hits[hi].object);
      if (cand && cand.state === "idle") { gazed = cand; break; }
    }

    for (var ikey in this.items) {
      var it = this.items[ikey];
      if (it.state !== "idle") continue;
      if (it === gazed) {
        it.gazeElapsed += (delta || 16);
        this._setPickRing(it.gazeElapsed / it.fuseDur);
        if (it.gazeElapsed >= it.fuseDur) {
          this._setPickRing(0);
          it.gazeElapsed = 0;
          this._pickup(it);
        }
      } else {
        if (it.gazeElapsed > 0) { it.gazeElapsed = 0; this._setPickRing(0); }
      }
    }
  }
});

/* ============================================================
   carry-manager v5  完整烘烤流程
   节点说明：
     bread      — 面包（独立节点）
     dish       — 碟子（在 oven.001 箱体内）
     oven       — 烤箱门（prop-manager 控制动画）
     oven.001   — 烤箱箱体
     <tableName>— 桌面放置目标（schema.tableName 配置，默认 "mesh"）

   完整状态机：
   idle
    → [凝视bread 2s 黄] → carrying
    → [凝视dish 2s 绿，需oven open] → placed_in_oven
    → [凝视oven关门，prop-manager处理] ← 玩家自己操作
    → 监听oven关门事件 → baking（同时给bread上色）
    → [凝视oven开门，prop-manager处理] ← 玩家自己操作
    → baked_idle（bread变色后在烤箱内，可拾取）
    → [凝视bread 2s 黄] → carrying_baked
    → [凝视桌面 2s 白] → done（放回桌面）
   ============================================================ */
AFRAME.registerComponent("carry-manager", {
  schema: {
    carryDist:    { type: "number", default: 0.6   },
    carryOffsetY: { type: "number", default: -0.15 },
    lerpSpeed:    { type: "number", default: 10    },
    fuseDur:      { type: "number", default: 2000  },
    ovenDoorName: { type: "string", default: "oven"     },
    ovenBodyName: { type: "string", default: "oven.001" },
    tableName:    { type: "string", default: "mesh"     },  // 桌面节点名，凝视此处放回
    bakedColor:   { type: "color",  default: "#EDA251"  }   // 烤好后面包颜色
  },

  init: function () {
    this.roomModel      = null;
    this.breadNode      = null;
    this.breadMeshes    = new Set();
    this.ovenBodyMeshes = new Set();
    this.dishNode       = null;
    this.tableMeshes    = new Set();   // 桌面 Mesh，放回目标

    // 状态机
    // idle | fusing_pickup | carrying |
    // fusing_place | placed_in_oven | baking |
    // baked_idle | fusing_pickup_baked | carrying_baked |
    // fusing_table | done
    this.state       = "idle";
    this.gazeElapsed = 0;
    this.baked       = false;   // 是否已烤熟

    // 原始放置位置（放入 dish 时记录，开门后恢复用）
    this._placedLocalPos = new THREE.Vector3();

    // 桌面放置位置（第一次拾起时记录）
    this._tableDropWP = new THREE.Vector3();
    this._hasTableDrop = false;

    this._camWP     = new THREE.Vector3();
    this._camDir    = new THREE.Vector3();
    this._targetWP  = new THREE.Vector3();
    this._curWP     = new THREE.Vector3();
    this._invParent = new THREE.Matrix4();

    this.ray = new THREE.Raycaster();
    this.ray.far = 8;
    this.fuseRing   = null;
    this.fuseRingBg = null;

    // 监听 prop-manager 的 oven 动画完成事件
    var self = this;
    this.el.addEventListener("model-loaded", this.onModelLoaded.bind(this));
    // prop-manager 动画完成会在 room el 上触发自定义事件（我们在 tick 里轮询状态即可）
  },

  /* ── 进度环 ── */
  _createFuseRing: function () {
    var cam = document.querySelector("#cam").object3D;
    this.fuseRingBg = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48),
      new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true,
        opacity: 0.35, side: THREE.DoubleSide, depthTest: false })
    );
    this.fuseRingBg.renderOrder = 9994;
    this.fuseRingBg.visible = false;
    cam.add(this.fuseRingBg);
    this.fuseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2, 0.001),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true,
        opacity: 0.95, side: THREE.DoubleSide, depthTest: false })
    );
    this.fuseRing.renderOrder = 9995;
    this.fuseRing.visible = false;
    cam.add(this.fuseRing);
  },
  _syncRingPos: function () {
    var ce = document.querySelector("[cursor]");
    if (!ce) return;
    var cz = ce.object3D.position.z, s = Math.abs(cz);
    if (this.fuseRingBg) { this.fuseRingBg.position.set(0,0,cz);       this.fuseRingBg.scale.set(s,s,s); }
    if (this.fuseRing)   { this.fuseRing.position.set(0,0,cz+0.001);   this.fuseRing.scale.set(s,s,s); }
  },
  _showRing: function (r, g, b) {
    if (!this.fuseRing) this._createFuseRing();
    this.fuseRing.material.color.setRGB(r, g, b);
    this.fuseRingBg.visible = true;
    this.fuseRing.visible   = true;
    this._updateRing(0);
  },
  _hideRing: function () {
    if (this.fuseRingBg) this.fuseRingBg.visible = false;
    if (this.fuseRing)   this.fuseRing.visible   = false;
  },
  _updateRing: function (pct) {
    if (!this.fuseRing) return;
    pct = Math.min(Math.max(pct, 0), 1);
    var newGeo = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI/2,
                                        Math.max(pct * Math.PI * 2, 0.001));
    this.fuseRing.geometry.dispose();
    this.fuseRing.geometry = newGeo;
    this._syncRingPos();
  },

  /* ── 载入模型 ── */
  onModelLoaded: function () {
    var model = this.el.getObject3D("mesh");
    if (!model) return;
    this.roomModel = model;
    var self = this;
    var bodyName  = this.data.ovenBodyName;
    var tableName = this.data.tableName;

    model.traverse(function (ch) {
      if (ch.name === "bread" && !self.breadNode) {
        self.breadNode = ch;
        ch.traverse(function(c){ if (c.isMesh) self.breadMeshes.add(c); });
        if (ch.isMesh) self.breadMeshes.add(ch);
        console.log("[carry] bread:", ch.name, "Mesh:", self.breadMeshes.size);
      }
      if (ch.name === bodyName && !self.ovenBodyMeshes.size) {
        ch.traverse(function(c){ if (c.isMesh) self.ovenBodyMeshes.add(c); });
        if (ch.isMesh) self.ovenBodyMeshes.add(ch);
        console.log("[carry] oven箱体:", ch.name, "Mesh:", self.ovenBodyMeshes.size);
      }
      if (ch.name === "dish" && !self.dishNode) {
        self.dishNode = ch;
        console.log("[carry] dish:", ch.name);
      }
      if (ch.name === tableName) {
        ch.traverse(function(c){ if (c.isMesh) self.tableMeshes.add(c); });
        if (ch.isMesh) self.tableMeshes.add(ch);
        console.log("[carry] 桌面:", ch.name, "Mesh:", self.tableMeshes.size);
      }
    });

    if (!self.breadNode)           console.warn("[carry] ⚠️ 未找到 bread");
    if (!self.ovenBodyMeshes.size) console.warn("[carry] ⚠️ 未找到 oven.001 箱体");
    if (!self.dishNode)            console.warn("[carry] ⚠️ 未找到 dish");
    if (!self.tableMeshes.size)    console.warn("[carry] ⚠️ 未找到桌面节点:", tableName);
  },

  /* ── 读 oven 门完整状态字符串（"open"/"closed"/"opening"/"closing"） ── */
  _getOvenDoorState: function () {
    var roomEl = document.querySelector("#room");
    if (!roomEl) return "unknown";
    var pm = roomEl.components["prop-manager"];
    if (!pm || !pm.props) return "unknown";
    var doorName = this.data.ovenDoorName;
    if (pm.props[doorName]) return pm.props[doorName].state;
    for (var k in pm.props) {
      if (k.toLowerCase() === doorName.toLowerCase()) return pm.props[k].state;
    }
    return "unknown";
  },

  /* ── 读 oven 门是否完全打开 ── */
  _isOvenOpen: function () {
    return this._getOvenDoorState() === "open";
  },

  /* ── 给 bread 上烘烤颜色 ── */
  _applyBakedColor: function () {
    var color = new THREE.Color(this.data.bakedColor);
    this.breadMeshes.forEach(function(m) {
      if (m.material) {
        // 克隆 material 避免影响其他共用同一材质的物体
        if (!m._origMaterial) m._origMaterial = m.material;
        m.material = m.material.clone();
        m.material.color.set(color);
        // 如果有贴图，叠加颜色而非替换（设置 vertexColors 以外的 color 即可）
        m.material.needsUpdate = true;
      }
    });
    this.baked = true;
    console.log("[carry] 🍞 面包烤熟，颜色变为", this.data.bakedColor);
  },

  /* ── 拾起 bread（适用于 idle 和 baked_idle） ── */
  _pickup: function () {
    if (!this.breadNode) return;
    // 记录桌面放置位置（仅初次拾起时记录，用于最后放回）
    if (!this._hasTableDrop && !this.baked) {
      this.breadNode.getWorldPosition(this._tableDropWP);
      this._hasTableDrop = true;
    }
    // 禁用 bread raycast 避免遮挡 prop-manager
    this.breadMeshes.forEach(function(m) { m.raycast = function(){}; });
    this.state = this.baked ? "carrying_baked" : "carrying";
    if (!this.baked) window.BreadHint && window.BreadHint.show();
    console.log("[carry] ✋ 拾起 bread，state →", this.state);
  },

  /* ── 放入 dish ── */
  _placeToDish: function () {
    if (!this.breadNode) return;
    this.breadMeshes.forEach(function(m) { delete m.raycast; });

    var targetWP = new THREE.Vector3();
    if (this.dishNode) {
      this.dishNode.getWorldPosition(targetWP);
    } else {
      this.ovenBodyMeshes.forEach(function(m) { m.getWorldPosition(targetWP); });
    }

    var parent = this.breadNode.parent;
    if (parent) {
      parent.updateMatrixWorld(true);
      this._invParent.copy(parent.matrixWorld).invert();
      var lp = targetWP.clone().applyMatrix4(this._invParent);
      lp.x += 0.15;
      lp.y += 0.06;
      lp.z += 0.1;
      this.breadNode.position.copy(lp);
      this.breadNode.rotation.set(0, 0, 0);
      // 记录放置的本地坐标，开门后面包仍在此
      this._placedLocalPos.copy(lp);
    }

    this.state = "placed_in_oven";
    window.BreadHint && window.BreadHint.hide();
    console.log("[carry] ✅ bread 放入 dish，等待关门烘烤");
  },

  /* ── 放回桌面 ── */
  _placeToTable: function () {
    if (!this.breadNode) return;
    this.breadMeshes.forEach(function(m) { delete m.raycast; });

    // 若记录了原始世界坐标则还原，否则放到准星当前位置
    var parent = this.breadNode.parent;
    if (parent && this._hasTableDrop) {
      parent.updateMatrixWorld(true);
      this._invParent.copy(parent.matrixWorld).invert();
      var lp = this._tableDropWP.clone().applyMatrix4(this._invParent);
      this.breadNode.position.copy(lp);
      this.breadNode.rotation.set(0, 0, 0);
    }

    this.state = "done";
    window.BreadHint && window.BreadHint.hide();
    console.log("[carry] 🍞 面包放回桌面，流程结束");
  },

  /* ── tick ── */
  tick: function (time, delta) {
    if (!this.roomModel || !this.breadNode) return;

    var cam = document.querySelector("#cam");
    if (!cam) return;
    var camObj = cam.object3D;
    camObj.getWorldPosition(this._camWP);
    camObj.getWorldDirection(this._camDir);
    this._camDir.negate();

    /* ══ bread 跟随准星（carrying / carrying_baked / fusing_place / fusing_table） ══ */
    var isCarrying = (this.state === "carrying" || this.state === "carrying_baked" ||
                      this.state === "fusing_place" || this.state === "fusing_table");
    if (isCarrying) {
      // ── 穿模保护：从相机沿视线检测障碍，动态缩短持物距离 ──
      var maxDist = this.data.carryDist;
      if (!this._clipRay) this._clipRay = new THREE.Raycaster();
      this._clipRay.set(this._camWP, this._camDir);
      this._clipRay.far = maxDist + 0.3;
      var clipHits = this._clipRay.intersectObject(this.roomModel, true);
      for (var ci = 0; ci < clipHits.length; ci++) {
        if (this.breadMeshes.has(clipHits[ci].object)) continue;  // 跳过面包自身
        var safeDist = clipHits[ci].distance - 0.09;
        if (safeDist < 0.15) safeDist = 0.15;
        if (safeDist < maxDist) maxDist = safeDist;
        break;
      }

      this._targetWP.copy(this._camWP).addScaledVector(this._camDir, maxDist);
      this._targetWP.y += this.data.carryOffsetY;
      this.breadNode.getWorldPosition(this._curWP);
      var t = Math.min((delta || 16) / 1000 * this.data.lerpSpeed, 1);
      this._curWP.lerp(this._targetWP, t);
      var parent = this.breadNode.parent;
      if (parent) {
        parent.updateMatrixWorld(true);
        this._invParent.copy(parent.matrixWorld).invert();
        this.breadNode.position.copy(this._curWP.clone().applyMatrix4(this._invParent));
      }
    }

    /* ══ placed_in_oven：轮询 oven 门状态，动画完全结束（state==="closed"）后变色 ══ */
    if (this.state === "placed_in_oven") {
      if (!this._bakingStarted && this._getOvenDoorState() === "closed") {
        // 动画完全播完（closing → closed）才变色
        this._bakingStarted = true;
        this._applyBakedColor();
        this.state = "baking";
        window.OvenHint && window.OvenHint.showBaking();
        console.log("[carry] 🔥 关门动画完成，面包变色");
      }
      return;
    }

    /* ══ baking：门已关、颜色已变，等待开门 ══ */
    if (this.state === "baking") {
      if (this._isOvenOpen()) {
        // 门再次打开 → 面包烤好，可拾取
        this._bakingStarted = false;
        this.state = "baked_idle";
        console.log("[carry] ✅ 烤箱打开，面包烤好！可拾取");
      }
      return;
    }

    this.ray.set(this._camWP, this._camDir);

    /* ══ idle / fusing_pickup：凝视 bread 拾起（未烤） ══ */
    if (this.state === "idle" || this.state === "fusing_pickup") {
      var hits = this.ray.intersectObject(this.roomModel, true);
      var gazing = false;
      for (var i = 0; i < hits.length; i++) {
        if (this.breadMeshes.has(hits[i].object)) { gazing = true; break; }
      }
      if (gazing) {
        this.gazeElapsed += (delta || 16);
        if (this.state === "idle") { this.state = "fusing_pickup"; this._showRing(1.0, 0.85, 0.1); }
        this._updateRing(this.gazeElapsed / this.data.fuseDur);
        if (this.gazeElapsed >= this.data.fuseDur) {
          this._hideRing(); this.gazeElapsed = 0; this._pickup();
        }
      } else {
        if (this.gazeElapsed > 0) { this._hideRing(); this.gazeElapsed = 0; }
        this.state = "idle";
      }
    }

    /* ══ baked_idle / fusing_pickup_baked：凝视 bread 拾起（已烤） ══ */
    else if (this.state === "baked_idle" || this.state === "fusing_pickup_baked") {
      var hitsB = this.ray.intersectObject(this.roomModel, true);
      var gazingB = false;
      for (var ib = 0; ib < hitsB.length; ib++) {
        if (this.breadMeshes.has(hitsB[ib].object)) { gazingB = true; break; }
      }
      if (gazingB) {
        this.gazeElapsed += (delta || 16);
        if (this.state === "baked_idle") {
          this.state = "fusing_pickup_baked";
          this._showRing(1.0, 0.6, 0.1);   // 橙色环 = 拾起烤好的面包
        }
        this._updateRing(this.gazeElapsed / this.data.fuseDur);
        if (this.gazeElapsed >= this.data.fuseDur) {
          this._hideRing(); this.gazeElapsed = 0; this._pickup();
        }
      } else {
        if (this.gazeElapsed > 0) { this._hideRing(); this.gazeElapsed = 0; }
        this.state = "baked_idle";
      }
    }

    /* ══ carrying：凝视 dish 放入（需 oven open，角度检测） ══ */
    else if (this.state === "carrying" || this.state === "fusing_place") {
      var canPlace = false;
      if (this.dishNode && this._isOvenOpen()) {
        var dishWP = new THREE.Vector3();
        this.dishNode.getWorldPosition(dishWP);
        var toDish = dishWP.clone().sub(this._camWP);
        var distToDish = toDish.length();
        toDish.normalize();
        var dot = toDish.dot(this._camDir);
        var angleDeg = Math.acos(Math.min(Math.max(dot, -1), 1)) * (180 / Math.PI);
        canPlace = (distToDish > 0.3 && distToDish < 4.0 && angleDeg < 25);
      }
      if (canPlace) {
        this.gazeElapsed += (delta || 16);
        if (this.state !== "fusing_place") { this.state = "fusing_place"; this._showRing(0.2, 0.8, 0.3); }
        this._updateRing(this.gazeElapsed / this.data.fuseDur);
        if (this.gazeElapsed >= this.data.fuseDur) {
          this._hideRing(); this.gazeElapsed = 0; this._placeToDish();
        }
      } else {
        if (this.state === "fusing_place") { this._hideRing(); this.gazeElapsed = 0; this.state = "carrying"; }
      }
    }

    /* ══ carrying_baked / fusing_table：凝视桌面放回 ══ */
    else if (this.state === "carrying_baked" || this.state === "fusing_table") {
      var hitsT = this.ray.intersectObject(this.roomModel, true);
      var gazingTable = false;
      for (var it = 0; it < hitsT.length; it++) {
        if (this.tableMeshes.has(hitsT[it].object)) { gazingTable = true; break; }
      }
      if (gazingTable) {
        this.gazeElapsed += (delta || 16);
        if (this.state !== "fusing_table") { this.state = "fusing_table"; this._showRing(1.0, 1.0, 1.0); }  // 白色环 = 放下
        this._updateRing(this.gazeElapsed / this.data.fuseDur);
        if (this.gazeElapsed >= this.data.fuseDur) {
          this._hideRing(); this.gazeElapsed = 0; this._placeToTable();
        }
      } else {
        if (this.state === "fusing_table") { this._hideRing(); this.gazeElapsed = 0; this.state = "carrying_baked"; }
      }
    }
  }
});


/* ============================================================
   手机端模式 + 半透明虚拟摇杆
   - 右下角按钮：进入 / 退出手机模式（类似进入 VR 模式）
   - 左下角半透明摇杆：控制前后左右移动（方向跟随当前视角）
   - 视角旋转仍由 look-controls 触摸拖拽完成（在屏幕其它区域滑动）
   - 移动直接叠加到 #cam 本地坐标，自动复用 simple-collision 碰撞，不会穿墙
   ============================================================ */
AFRAME.registerComponent("mobile-controls", {
  schema: {
    speed:    { type: "number",  default: 1.6 },   // 移动速度 (米/秒)
    maxR:     { type: "number",  default: 35  },    // 摇杆最大行程(px)，需与CSS匹配
    autoShow: { type: "boolean", default: false },  // 在移动设备上自动开启
    lookSens: { type: "number",  default: 0.005 },  // 拖动转视角灵敏度 (弧度/像素)
    invertX:  { type: "boolean", default: false },  // 反转左右(改成"抓住世界"手感)
    invertY:  { type: "boolean", default: false }   // 反转上下
  },

  init: function () {
    this.active = false;
    this.move   = { x: 0, y: 0 };
    this.camEl  = document.querySelector("#cam");

    this._dir   = new THREE.Vector3();
    this._fwd   = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up    = new THREE.Vector3(0, 1, 0);
    this._delta = new THREE.Vector3();

    this._injectStyles();
    this._buildUI();
    this._bindJoystick();
    this._bindLook();

    var self  = this;
    var scene = this.el.sceneEl || this.el;
    // 进入 VR 时隐藏网页端 UI，退出时恢复
    scene.addEventListener("enter-vr", function () { self._setUIVisible(false); });
    scene.addEventListener("exit-vr",  function () { self._setUIVisible(true);  });

    if (this.data.autoShow && AFRAME.utils.device.isMobile()) this.enable();
  },

  _injectStyles: function () {
    if (document.getElementById("mobileControlsCSS")) return;
    var css = document.createElement("style");
    css.id = "mobileControlsCSS";
    css.textContent = [
      "#mobileModeBtn{position:fixed;right:14px;bottom:74px;z-index:9999;",
      "padding:10px 16px;border:none;border-radius:24px;font-size:14px;",
      "font-family:sans-serif;color:#fff;background:rgba(0,0,0,0.45);",
      "-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);",
      "cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;",
      "transition:background .2s;}",
      "#mobileModeBtn.active{background:rgba(0,170,110,0.85);}",

      "#joystickBase{position:fixed;left:26px;bottom:30px;z-index:9999;",
      "width:130px;height:130px;border-radius:50%;",
      "background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.35);",
      "box-shadow:0 0 12px rgba(0,0,0,0.25);touch-action:none;display:none;}",

      "#joystickStick{position:absolute;left:50%;top:50%;width:60px;height:60px;",
      "margin:-30px 0 0 -30px;border-radius:50%;",
      "background:rgba(255,255,255,0.55);border:2px solid rgba(255,255,255,0.8);",
      "box-shadow:0 2px 8px rgba(0,0,0,0.3);transform:translate(0px,0px);",
      "pointer-events:none;}"
    ].join("");
    document.head.appendChild(css);
  },

  _buildUI: function () {
    var self = this;
    var btn = document.createElement("button");
    btn.id = "mobileModeBtn";
    btn.type = "button";
    btn.textContent = "📱 手机模式";
    document.body.appendChild(btn);
    this.btn = btn;
    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation(); self.toggle();
    });

    var base  = document.createElement("div"); base.id  = "joystickBase";
    var stick = document.createElement("div"); stick.id = "joystickStick";
    base.appendChild(stick);
    document.body.appendChild(base);
    this.base = base; this.stick = stick;
  },

  _bindJoystick: function () {
    var self = this, base = this.base, stick = this.stick;
    var dragging = false, touchId = null, cx = 0, cy = 0;
    var maxR = this.data.maxR;

    function center() {
      var r = base.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
    }
    function start(x, y, id) { dragging = true; touchId = id; center(); update(x, y); }
    function update(x, y) {
      if (!dragging) return;
      var dx = x - cx, dy = y - cy;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxR) { dx = dx / d * maxR; dy = dy / d * maxR; }
      stick.style.transform = "translate(" + dx + "px," + dy + "px)";
      self.move.x = dx / maxR;     // 右为正
      self.move.y = dy / maxR;     // 下为正（上为负）
    }
    function end() {
      dragging = false; touchId = null;
      stick.style.transform = "translate(0px,0px)";
      self.move.x = 0; self.move.y = 0;
    }

    // —— 触摸（手机）——
    base.addEventListener("touchstart", function (e) {
      e.preventDefault();
      var t = e.changedTouches[0];
      start(t.clientX, t.clientY, t.identifier);
    }, { passive: false });

    window.addEventListener("touchmove", function (e) {
      if (!dragging) return;
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === touchId) { e.preventDefault(); update(t.clientX, t.clientY); break; }
      }
    }, { passive: false });

    function touchEndHandler(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchId) { end(); break; }
      }
    }
    window.addEventListener("touchend",    touchEndHandler);
    window.addEventListener("touchcancel", touchEndHandler);

    // —— 鼠标（方便在电脑上测试摇杆）——
    base.addEventListener("mousedown", function (e) {
      e.preventDefault(); start(e.clientX, e.clientY, "mouse");
    });
    window.addEventListener("mousemove", function (e) {
      if (dragging && touchId === "mouse") update(e.clientX, e.clientY);
    });
    window.addEventListener("mouseup", function () {
      if (touchId === "mouse") end();
    });
  },

  /* ---- 手指拖动转视角：同时控制 左右(yaw) + 上下(pitch)，方向跟随手指 ---- */
  _bindLook: function () {
    var self = this;
    var scene = this.el.sceneEl || this.el;

    var dragging = false, lookId = null, lastX = 0, lastY = 0;
    var PITCH_LIMIT = Math.PI / 2 - 0.01;  // 上下限制 ±~89°，避免翻转

    function getLC() {
      var camEl = self.camEl || (self.camEl = document.querySelector("#cam"));
      return (camEl && camEl.components) ? camEl.components["look-controls"] : null;
    }

    function applyDelta(dx, dy) {
      var lc = getLC();
      if (!lc || !lc.yawObject || !lc.pitchObject) return;
      var s  = self.data.lookSens;
      var sx = self.data.invertX ? -1 : 1;
      var sy = self.data.invertY ? -1 : 1;
      // 默认手感：向左拖→看向左，向上拖→看向上（跟随手指）
      lc.yawObject.rotation.y   -= dx * s * sx;
      lc.pitchObject.rotation.x -= dy * s * sy;
      // 夹住俯仰角
      var p = lc.pitchObject.rotation.x;
      lc.pitchObject.rotation.x = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p));
    }

    function startLook(x, y) { dragging = true; lastX = x; lastY = y; }
    function moveLook(x, y) {
      if (!dragging) return;
      applyDelta(x - lastX, y - lastY);
      lastX = x; lastY = y;
    }
    function endLook() { dragging = false; lookId = null; }

    function getCanvas() { return scene.canvas; }

    // 触摸：监听画布。落在摇杆/按钮上的触摸不会到达画布，自动互不干扰
    function onTouchStart(e) {
      if (!self.active) return;            // 仅手机模式下接管
      var t = e.changedTouches[0];
      lookId = t.identifier;
      startLook(t.clientX, t.clientY);
    }
    function onTouchMove(e) {
      if (!self.active || !dragging) return;
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === lookId) {
          e.preventDefault();
          moveLook(t.clientX, t.clientY);
          break;
        }
      }
    }
    function onTouchEnd(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lookId) { endLook(); break; }
      }
    }

    function bindCanvas() {
      var c = getCanvas();
      if (!c || c._mcLookBound) return;
      c._mcLookBound = true;
      c.addEventListener("touchstart", onTouchStart, { passive: true });
      c.addEventListener("touchmove",  onTouchMove,  { passive: false });
      window.addEventListener("touchend",    onTouchEnd);
      window.addEventListener("touchcancel", onTouchEnd);

      // 鼠标：方便在电脑上测试拖动转视角
      c.addEventListener("mousedown", function (e) {
        if (!self.active) return;
        lookId = "mouse"; startLook(e.clientX, e.clientY);
      });
      window.addEventListener("mousemove", function (e) {
        if (lookId === "mouse") moveLook(e.clientX, e.clientY);
      });
      window.addEventListener("mouseup", function () {
        if (lookId === "mouse") endLook();
      });
    }

    if (scene.canvas) bindCanvas();
    else scene.addEventListener("render-target-loaded", bindCanvas);
    scene.addEventListener("loaded", bindCanvas);
  },

  _setUIVisible: function (v) {
    this.btn.style.display  = v ? "block" : "none";
    this.base.style.display = (v && this.active) ? "block" : "none";
  },

  /* ---- 全屏（带浏览器前缀兼容） ---- */
  _requestFullscreen: function () {
    var el = document.documentElement;
    var fn = el.requestFullscreen || el.webkitRequestFullscreen ||
             el.mozRequestFullScreen || el.msRequestFullscreen;
    if (fn) { try { fn.call(el); } catch (e) {} }
  },
  _exitFullscreen: function () {
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement ||
               document.mozFullScreenElement || document.msFullscreenElement;
    if (!fsEl) return;
    var fn = document.exitFullscreen || document.webkitExitFullscreen ||
             document.mozCancelFullScreen || document.msExitFullscreen;
    if (fn) { try { fn.call(document); } catch (e) {} }
  },

  /* ---- 切换陀螺仪追踪 ----
     gyroEnabled=true  : 普通模式，look-controls 自己处理触摸+陀螺仪
     gyroEnabled=false : 手机模式，关闭陀螺仪与 look-controls 触摸，改由 _bindLook 接管
                          (这样才能同时上下/左右，且方向跟随手指)            */
  _setMagicWindow: function (gyroEnabled) {
    var camEl = this.camEl || (this.camEl = document.querySelector("#cam"));
    if (!camEl) return;
    var lc = camEl.components && camEl.components["look-controls"];

    // 进入手机模式前，把当前朝向写回 yaw/pitch，避免关闭陀螺仪瞬间视角跳动
    if (!gyroEnabled && lc && lc.yawObject && lc.pitchObject) {
      var rot = camEl.object3D.rotation;
      lc.yawObject.rotation.y   = rot.y;
      lc.pitchObject.rotation.x = rot.x;
    }

    // 手机模式下关闭 look-controls 自带触摸（仅做 yaw 且方向相反），交给自定义处理
    camEl.setAttribute("look-controls", "touchEnabled", gyroEnabled);
    camEl.setAttribute("look-controls", "magicWindowTrackingEnabled", gyroEnabled);
    if (lc && lc.magicWindowControls) lc.magicWindowControls.enabled = gyroEnabled;
  },

  enable: function () {
    this.active = true;
    this.base.style.display = "block";
    this.btn.classList.add("active");
    this.btn.textContent = "📱 退出手机模式";
    this._requestFullscreen();   // 1. 进入全屏（需由点击手势触发，已满足）
    this._setMagicWindow(false); // 2. 关闭陀螺仪，改用手指拖动转视角
  },
  disable: function () {
    this.active = false;
    this.base.style.display = "none";
    this.btn.classList.remove("active");
    this.btn.textContent = "📱 手机模式";
    this.move.x = 0; this.move.y = 0;
    this.stick.style.transform = "translate(0px,0px)";
    this._exitFullscreen();      // 退出全屏
    this._setMagicWindow(true);  // 恢复默认陀螺仪追踪
  },
  toggle: function () { this.active ? this.disable() : this.enable(); },

  tick: function (time, delta) {
    if (!this.active) return;
    if (this.move.x === 0 && this.move.y === 0) return;
    var camEl = this.camEl || (this.camEl = document.querySelector("#cam"));
    if (!camEl) return;
    var camObj = camEl.object3D;

    // 相机水平朝向：look 方向 = -getWorldDirection
    camObj.getWorldDirection(this._dir);
    this._fwd.set(-this._dir.x, 0, -this._dir.z);
    if (this._fwd.lengthSq() < 1e-6) return;
    this._fwd.normalize();
    this._right.crossVectors(this._fwd, this._up).normalize();   // 右方向

    var dt   = Math.min(delta || 16, 100) / 1000;
    var step = this.data.speed * dt;

    // 摇杆向上(move.y<0)=前进；向右(move.x>0)=右移
    this._delta.set(0, 0, 0);
    this._delta.addScaledVector(this._fwd,  -this.move.y * step);
    this._delta.addScaledVector(this._right, this.move.x * step);

    // 叠加到相机本地坐标（rig 无旋转，方向世界≈本地），交给 simple-collision 处理阻挡
    camObj.position.x += this._delta.x;
    camObj.position.z += this._delta.z;
  }
});

/* 自动把 mobile-controls 挂到 <a-scene> 上（无需手动改 HTML） */
window.addEventListener("DOMContentLoaded", function () {
  var attach = function () {
    var scene = document.querySelector("a-scene");
    if (scene && !scene.hasAttribute("mobile-controls")) {
      scene.setAttribute("mobile-controls", "");
    }
  };
  var scene = document.querySelector("a-scene");
  if (scene && scene.hasLoaded) attach();
  else if (scene)               scene.addEventListener("loaded", attach);
  else                          attach();
});

/* ============================================================
   低多边形明亮校园环境（kode 风格）  street-environment
   - 以“瞬移圆盘所在高度(=房屋地板)”为水平线，房屋不再悬空
   - 奶白地面 + 红土球场(白线) + 草坪 + 路径
   - 暖木格栅矮楼(平屋顶) + 蓬松圆树 + 棕榈 + 路灯 + 长椅 + 旗帜
   - 渐变青绿天空 + 远景雾化；全部合并几何/实例化，运行期无 tick
   - 不参与碰撞/瞬移/开门射线(这些只针对 #room 与圆盘)
   说明：本场景为“同类美术风格”的原创搭建，并非复制对方专有模型/资源。
   ============================================================ */
AFRAME.registerComponent("street-environment", {
  schema: {
    plot:       { type: "number",  default: 24 },   // 地块尺寸(米)
    grid:       { type: "number",  default: 5 },    // 向外扩展的地块圈数
    groundSize: { type: "number",  default: 360 },  // 地面平面边长(米)
    fogNear:    { type: "number",  default: 45 },
    fogFar:     { type: "number",  default: 190 },
    density:    { type: "number",  default: 1.0 }   // 整体繁密度(树/灯等)
  },

  init: function () {
    this.built = false;
    var el = this.el;
    if (el.getObject3D("mesh")) this.build();
    else el.addEventListener("model-loaded", this.build.bind(this), { once: true });
  },

  build: function () {
    if (this.built) return;
    this.built = true;

    // —— 明亮校园配色 ——
    this.C = {
      skyTop:  "#4fb7c9", skyMid: "#a9dde2", skyLow: "#e4f3f1",
      fog:     "#e4f3f1",
      ground:  "#efe8d6", path: "#f6f1e3", curb: "#ffffff",
      court:   "#dc8a6e", courtLine: "#f6f1e8",
      lawn:    "#bcd89a", lawnDark: "#aacf8c",
      wall:    "#f2efe8", batten: "#c6a577", roof: "#e3ded2", base: "#d8d2c4",
      trunk:   "#bf9d6e",
      lamp:    "#3b4a57", lampHead: "#fce6a6",
      benchW:  "#f1ede3", benchWood: "#c6a577",
      banner:  "#7d4fb0", bannerPole: "#9aa3ac"
    };
    this.treeGreens = ["#86c39a", "#9ed0a0", "#74b58e", "#8fc8a4"];

    // —— 关键：以瞬移圆盘高度为地板基准，避免悬空 ——
    this.groundY = this._detectFloorY();

    // —— 房屋水平中心 + 占地范围(用于避让) ——
    var box = new THREE.Box3().setFromObject(this.el.object3D);
    var c = box.getCenter(new THREE.Vector3());
    this.cx = c.x; this.cz = c.z;
    this.house = {
      minX: box.min.x - 5, maxX: box.max.x + 5,
      minZ: box.min.z - 5, maxZ: box.max.z + 5
    };

    this.root = this.el.sceneEl.object3D;
    this.rng  = this._mulberry(20240607);

    this._buildSky();
    this._buildGround();
    this._planAndBuild();   // 规划地块：楼/球场/草坪 + 树/灯/椅/旗
    this._applyFog();
  },

  /* ================= 工具 ================= */
  _detectFloorY: function () {
    var disks = document.querySelectorAll("[smooth-teleport]");
    if (disks.length) {
      var v = new THREE.Vector3(), sum = 0, n = 0;
      for (var i = 0; i < disks.length; i++) {
        if (disks[i].object3D) { disks[i].object3D.getWorldPosition(v); sum += v.y; n++; }
      }
      if (n) return sum / n;
    }
    var box = new THREE.Box3().setFromObject(this.el.object3D);
    return box.min.y;
  },
  _mulberry: function (a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  _srgbTex: function (tex) {
    if ("colorSpace" in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    else if ("encoding" in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
    return tex;
  },
  // 顶点色按线性空间写入(配合 colorManagement)
  _vc: function (hex) {
    var col = new THREE.Color(hex);
    if (col.convertSRGBToLinear) col.convertSRGBToLinear();
    return [col.r, col.g, col.b];
  },
  _overlapHouse: function (x, z, half) {
    return (x + half > this.house.minX && x - half < this.house.maxX &&
            z + half > this.house.minZ && z - half < this.house.maxZ);
  },

  _applyFog: function () {
    var scene = this.el.sceneEl;
    scene.setAttribute("fog", { type: "linear", color: this.C.fog,
      near: this.data.fogNear, far: this.data.fogFar });
    scene.setAttribute("background", { color: this.C.fog });
  },

  /* ============ 合并/构件工具 ============ */
  // 合并(非索引)几何，含 position/normal/uv/color
  _mergeGeoms: function (geoms) {
    var total = 0, i;
    for (i = 0; i < geoms.length; i++) total += geoms[i].attributes.position.count;
    var pos = new Float32Array(total * 3), nor = new Float32Array(total * 3),
        uv  = new Float32Array(total * 2), col = new Float32Array(total * 3);
    var pO = 0, uO = 0;
    for (i = 0; i < geoms.length; i++) {
      var g = geoms[i];
      pos.set(g.attributes.position.array, pO);
      nor.set(g.attributes.normal.array, pO);
      col.set(g.attributes.color.array, pO);
      uv.set(g.attributes.uv.array, uO);
      pO += g.attributes.position.array.length;
      uO += g.attributes.uv.array.length;
      g.dispose();
    }
    var m = new THREE.BufferGeometry();
    m.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    m.setAttribute("normal",   new THREE.BufferAttribute(nor, 3));
    m.setAttribute("uv",       new THREE.BufferAttribute(uv, 2));
    m.setAttribute("color",    new THREE.BufferAttribute(col, 3));
    m.computeBoundingSphere();
    return m;
  },
  // 给一块几何统一写顶点色并转非索引；可单独覆盖某些面(faceColors:{faceIndex:[r,g,b]})
  _colorize: function (geo, rgb, faceColors) {
    var g = geo.index ? geo.toNonIndexed() : geo;
    var cnt = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(cnt * 2), 2));
    var arr = new Float32Array(cnt * 3);
    for (var k = 0; k < cnt; k++) { arr[k*3]=rgb[0]; arr[k*3+1]=rgb[1]; arr[k*3+2]=rgb[2]; }
    if (faceColors) {                 // 每面 6 个顶点(非索引三角化后) → 这里按 Box 面(每面2三角=6顶点)
      for (var f in faceColors) {
        var fc = faceColors[f], s = (+f) * 6;
        for (var v = 0; v < 6; v++) { var idx = s + v; if (idx < cnt) { arr[idx*3]=fc[0]; arr[idx*3+1]=fc[1]; arr[idx*3+2]=fc[2]; } }
      }
    }
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    return g;
  },
  // 由多块(已上色)几何合并出一个“单元”几何(用于实例化)
  _unit: function (parts) { return this._mergeGeoms(parts); },

  /* ============ 天空穹顶 ============ */
  _buildSky: function () {
    var cv = document.createElement("canvas"); cv.width = 16; cv.height = 256;
    var g = cv.getContext("2d");
    var grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0.0, this.C.skyTop);
    grd.addColorStop(0.5, this.C.skyMid);
    grd.addColorStop(1.0, this.C.skyLow);
    g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
    var tex = this._srgbTex(new THREE.CanvasTexture(cv));
    var mesh = new THREE.Mesh(
      new THREE.SphereGeometry(800, 24, 16),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    mesh.position.set(this.cx, this.groundY, this.cz);
    mesh.renderOrder = -1;
    this.root.add(mesh);
  },

  /* ============ 地面(奶白 + 浅路径网格) ============ */
  _groundTexture: function () {
    var S = 256, cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    var g = cv.getContext("2d");
    g.fillStyle = this.C.ground; g.fillRect(0, 0, S, S);
    // 浅色路径(地块边缘)
    var pw = S * 0.16;
    g.fillStyle = this.C.path;
    g.fillRect(0, 0, S, pw); g.fillRect(0, S - pw, S, pw);
    g.fillRect(0, 0, pw, S); g.fillRect(S - pw, 0, pw, S);
    // 路缘白线
    g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 3;
    g.strokeRect(pw, pw, S - 2 * pw, S - 2 * pw);
    return this._srgbTex(new THREE.CanvasTexture(cv));
  },
  _buildGround: function () {
    var P = this.data.plot, G = this.data.groundSize;
    var tex = this._groundTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(G / P, G / P);
    if (tex.anisotropy !== undefined) tex.anisotropy = 4;
    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(G, G),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.97, metalness: 0 })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(this.cx, this.groundY - 0.02, this.cz);
    this.root.add(mesh);
  },

  /* ============ 建筑(暖木格栅矮楼) ============ */
  _facadeTex: function () {
    var S = 128, cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    var g = cv.getContext("2d");
    g.fillStyle = "#f4f1ea"; g.fillRect(0, 0, S, S);          // 墙白(左侧为“留白”→也给屋顶用)
    // 暖木竖向格栅(右侧)
    var bx = S * 0.60, bw = S * 0.26;
    var grd = g.createLinearGradient(bx, 0, bx + bw, 0);
    grd.addColorStop(0, "#cdb083"); grd.addColorStop(0.5, "#c6a577"); grd.addColorStop(1, "#b9966a");
    g.fillStyle = grd; g.fillRect(bx, 0, bw, S);
    // 楼层线(底部细线，竖向平铺即每层一道)
    g.fillStyle = "rgba(120,105,80,0.25)"; g.fillRect(0, S - 4, S, 4);
    return this._srgbTex(new THREE.CanvasTexture(cv));
  },
  // 一栋楼几何：底面置于 groundY，侧面平铺格栅，顶/底取“留白”区并染屋顶色
  _buildingGeo: function (x, z, w, h, d) {
    var geo = new THREE.BoxGeometry(w, h, d);
    var uv = geo.attributes.uv;
    var cellW = 1.7, cellH = 3.2;     // 每格(批栅/楼层)真实尺寸
    var ru = { 0: d/cellW, 1: d/cellW, 2: 0, 3: 0, 4: w/cellW, 5: w/cellW };
    var rv = { 0: h/cellH, 1: h/cellH, 2: 0, 3: 0, 4: h/cellH, 5: h/cellH };
    for (var f = 0; f < 6; f++) {
      for (var v = 0; v < 4; v++) {
        var idx = f*4 + v;
        if (f === 2 || f === 3) uv.setXY(idx, 0.12, 0.5);          // 顶/底→留白区(纯墙白)
        else uv.setXY(idx, uv.getX(idx)*ru[f], uv.getY(idx)*rv[f]);
      }
    }
    geo.translate(x, this.groundY + h/2, z);
    // 顶面(面2)染屋顶色，其余墙白(纹理相乘)
    var wall = this._vc(this.C.wall), roof = this._vc(this.C.roof);
    return this._colorize(geo, wall, { 2: roof });
  },

  /* ============ 球场 / 草坪(合并平面) ============ */
  _courtTex: function () {
    var S = 256, cv = document.createElement("canvas"); cv.width = S; cv.height = S;
    var g = cv.getContext("2d");
    g.fillStyle = this.C.court; g.fillRect(0, 0, S, S);
    g.strokeStyle = this.C.courtLine; g.lineWidth = 4;
    var m = S * 0.10;
    g.strokeRect(m, m, S - 2*m, S - 2*m);          // 外框
    g.beginPath(); g.moveTo(S/2, m); g.lineTo(S/2, S - m); g.stroke();   // 中线
    g.beginPath(); g.moveTo(m, S/2); g.lineTo(S - m, S/2); g.stroke();   // 横线
    g.lineWidth = 3;
    g.strokeRect(S*0.28, S*0.28, S*0.44, S*0.44);  // 内框
    return this._srgbTex(new THREE.CanvasTexture(cv));
  },
  _flatPlane: function (x, z, w, d, yOff, rgb) {
    var geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI/2);
    geo.translate(x, this.groundY + yOff, z);
    return this._colorize(geo, rgb);
  },

  /* ============ 规划地块并搭建 ============ */
  _planAndBuild: function () {
    var P = this.data.plot, K = this.data.grid, rng = this.rng;
    var buildGeoms = [], courtGeoms = [], lawnGeoms = [];
    var treePts = [], palmPts = [], lampPts = [], benchPts = [], bannerPts = [];

    var courtRGB = this._vc("#ffffff");           // 球场用白色顶点(让纹理本色显示)
    var lawnA = this._vc(this.C.lawn), lawnB = this._vc(this.C.lawnDark);

    for (var i = -K; i <= K; i++) {
      for (var j = -K; j <= K; j++) {
        var px = this.cx + i * P, pz = this.cz + j * P;
        var nearHouse = this._overlapHouse(px, pz, P * 0.5);
        var r = rng();

        // 地块边缘布树(无论类型都种点树，营造绿意)
        for (var t = 0; t < 4; t++) {
          if (rng() < 0.45) continue;
          var ex = px + (t < 2 ? (t === 0 ? -1 : 1) * P * 0.42 : (rng()*2-1) * P * 0.3);
          var ez = pz + (t < 2 ? (rng()*2-1) * P * 0.3 : (t === 2 ? -1 : 1) * P * 0.42);
          if (this._overlapHouse(ex, ez, 1.2)) continue;
          treePts.push({ x: ex + (rng()-0.5), z: ez + (rng()-0.5) });
        }

        if (nearHouse) continue;   // 房屋周边留作广场，不放大型物件

        if (r < 0.34) {
          // —— 建筑(1~2 栋矮楼) ——
          var n = 1 + (rng() < 0.4 ? 1 : 0);
          for (var b = 0; b < n; b++) {
            var w = 9 + rng() * 9, d = 9 + rng() * 9;
            var h = 6 + rng() * rng() * 16;             // 偏矮
            var off = (P - Math.max(w, d)) / 2 - 1.5;
            var bxp = px + (n > 1 ? (b === 0 ? -1 : 1) * Math.min(off, 5) : (rng()*2-1)*Math.max(0, off));
            var bzp = pz + (rng()*2-1) * Math.max(0, off * 0.4);
            buildGeoms.push(this._buildingGeo(bxp, bzp, w, h, d));
          }
          // 楼前一盏灯 + 旗
          lampPts.push({ x: px - P*0.35, z: pz + P*0.35 });
          if (rng() < 0.4) bannerPts.push({ x: px + P*0.35, z: pz - P*0.30 });
        } else if (r < 0.58) {
          // —— 红土球场 + 周边长椅/灯 ——
          var cs = P * 0.66;
          courtGeoms.push(this._flatPlane(px, pz, cs, cs * 0.62, 0.012, courtRGB));
          benchPts.push({ x: px, z: pz + cs*0.42 });
          benchPts.push({ x: px, z: pz - cs*0.42 });
          lampPts.push({ x: px + cs*0.55, z: pz });
          lampPts.push({ x: px - cs*0.55, z: pz });
        } else if (r < 0.78) {
          // —— 草坪 + 几棵树/棕榈 ——
          var ls = P * 0.7;
          lawnGeoms.push(this._flatPlane(px, pz, ls, ls, 0.008, rng() < 0.5 ? lawnA : lawnB));
          for (var k2 = 0; k2 < 3; k2++)
            treePts.push({ x: px + (rng()*2-1)*ls*0.35, z: pz + (rng()*2-1)*ls*0.35 });
          if (rng() < 0.5) palmPts.push({ x: px + (rng()*2-1)*ls*0.3, z: pz + (rng()*2-1)*ls*0.3 });
        } else {
          // —— 小广场：灯 + 椅 + 旗 ——
          lampPts.push({ x: px, z: pz });
          if (rng() < 0.6) benchPts.push({ x: px + 2.2, z: pz });
          if (rng() < 0.5) bannerPts.push({ x: px - 2.2, z: pz });
          if (rng() < 0.5) palmPts.push({ x: px + (rng()*2-1)*P*0.25, z: pz + (rng()*2-1)*P*0.25 });
        }
      }
    }

    if (buildGeoms.length) {
      var fac = this._facadeTex(); fac.wrapS = fac.wrapT = THREE.RepeatWrapping;
      this.root.add(new THREE.Mesh(this._mergeGeoms(buildGeoms),
        new THREE.MeshStandardMaterial({ map: fac, vertexColors: true, roughness: 0.8, metalness: 0 })));
    }
    if (courtGeoms.length) {
      var ct = this._courtTex();
      this.root.add(new THREE.Mesh(this._mergeGeoms(courtGeoms),
        new THREE.MeshStandardMaterial({ map: ct, vertexColors: true, roughness: 0.95, metalness: 0 })));
    }
    if (lawnGeoms.length) {
      this.root.add(new THREE.Mesh(this._mergeGeoms(lawnGeoms),
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })));
    }

    this._buildTrees(treePts);
    this._buildPalms(palmPts);
    this._buildLamps(lampPts);
    this._buildBenches(benchPts);
    this._buildBanners(bannerPts);
  },

  /* ============ 实例化道具 ============ */
  _placeInstanced: function (geo, mat, pts, perInstance) {
    if (!pts.length) return;
    var mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(),
        p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0,1,0);
    for (var i = 0; i < pts.length; i++) {
      var cfg = perInstance(i, pts[i]) || {};
      q.setFromAxisAngle(up, cfg.ry || 0);
      p.set(pts[i].x, this.groundY + (cfg.y || 0), pts[i].z);
      var sc = cfg.s || 1, sy = cfg.sy || sc;
      s.set(sc, sy, sc);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (cfg.color && mesh.instanceColor === null) {} // 顶点色优先，不混用
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);
    return mesh;
  },

  // 蓬松圆树：树干(实例) + 圆冠(实例，圆冠按实例上色)
  _buildTrees: function (pts) {
    if (!pts.length) return;
    var rng = this.rng;
    var trunkGeo = new THREE.CylinderGeometry(0.13, 0.18, 1, 6); trunkGeo.translate(0, 0.5, 0);
    var trunkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.C.trunk), roughness: 0.9 });
    // 圆冠：细分球做轻微起伏 → 蓬松
    var canopyGeo = new THREE.IcosahedronGeometry(1, 1);
    var pos = canopyGeo.attributes.position; var v = new THREE.Vector3();
    for (var a = 0; a < pos.count; a++) {
      v.fromBufferAttribute(pos, a); var f = 0.88 + ((Math.sin(a*12.9898)*43758.5453) % 1 + 1) % 1 * 0.22;
      v.multiplyScalar(f); pos.setXYZ(a, v.x, v.y, v.z);
    }
    canopyGeo.computeVertexNormals();
    var canopyMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });

    var N = pts.length;
    var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
    var canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, N);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(),
        s = new THREE.Vector3(), up = new THREE.Vector3(0,1,0);
    for (var i = 0; i < N; i++) {
      var th = 1.8 + rng() * 1.8, cr = 1.3 + rng() * 1.1;
      q.set(0,0,0,1);
      p.set(pts[i].x, this.groundY, pts[i].z); s.set(1, th, 1);
      m.compose(p, q, s); trunks.setMatrixAt(i, m);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      p.set(pts[i].x, this.groundY + th + cr*0.5, pts[i].z); s.set(cr, cr*1.05, cr);
      m.compose(p, q, s); canopies.setMatrixAt(i, m);
      var g = this._vc(this.treeGreens[(rng()*this.treeGreens.length)|0]);
      canopies.setColorAt(i, new THREE.Color(g[0], g[1], g[2]));
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    this.root.add(trunks); this.root.add(canopies);
  },

  // 棕榈：细高树干 + 放射状叶片(合并单元)
  _buildPalms: function (pts) {
    if (!pts.length) return;
    var rng = this.rng;
    var trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6); trunkGeo.translate(0, 0.5, 0);
    var trunkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(this.C.trunk), roughness: 0.9 });
    // 叶冠单元：6 片细长叶(扁盒)放射 + 下垂
    var fronds = [];
    var leaf = this._vc("#7cba84");
    for (var f = 0; f < 6; f++) {
      var lg = new THREE.BoxGeometry(1.7, 0.06, 0.5);
      lg.translate(0.85, 0, 0);
      lg.rotateZ(-0.5);                          // 下垂
      lg.rotateY(f * Math.PI / 3);
      fronds.push(this._colorize(lg, leaf));
    }
    var frondGeo = this._mergeGeoms(fronds);
    var frondMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });

    var N = pts.length;
    var trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
    var crowns = new THREE.InstancedMesh(frondGeo, frondMat, N);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(),
        s = new THREE.Vector3(), up = new THREE.Vector3(0,1,0);
    for (var i = 0; i < N; i++) {
      var th = 4 + rng() * 2.5, cs = 1.2 + rng() * 0.6;
      q.set(0,0,0,1);
      p.set(pts[i].x, this.groundY, pts[i].z); s.set(1, th, 1);
      m.compose(p, q, s); trunks.setMatrixAt(i, m);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      p.set(pts[i].x, this.groundY + th, pts[i].z); s.set(cs, cs, cs);
      m.compose(p, q, s); crowns.setMatrixAt(i, m);
    }
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    this.root.add(trunks); this.root.add(crowns);
  },

  // 路灯：细高杆 + 顶部灯头(顶点色合并单元，单 draw call)
  _buildLamps: function (pts) {
    if (!pts.length) return;
    var pole = new THREE.CylinderGeometry(0.06, 0.08, 5, 6); pole.translate(0, 2.5, 0);
    var arm  = new THREE.BoxGeometry(0.06, 0.06, 0.9); arm.translate(0, 5, 0.4);
    var head = new THREE.BoxGeometry(0.4, 0.18, 0.5); head.translate(0, 4.95, 0.85);
    var dark = this._vc(this.C.lamp), warm = this._vc(this.C.lampHead);
    var unit = this._mergeGeoms([ this._colorize(pole, dark), this._colorize(arm, dark), this._colorize(head, warm) ]);
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 });
    var rng = this.rng;
    this._placeInstanced(unit, mat, pts, function () { return { ry: rng() * Math.PI * 2 }; });
  },

  // 长椅：座板 + 靠背 + 椅腿(顶点色合并单元)
  _buildBenches: function (pts) {
    if (!pts.length) return;
    var wood = this._vc(this.C.benchWood), white = this._vc(this.C.benchW);
    var seat = new THREE.BoxGeometry(1.6, 0.1, 0.5); seat.translate(0, 0.45, 0);
    var back = new THREE.BoxGeometry(1.6, 0.4, 0.08); back.translate(0, 0.7, -0.21);
    var l1 = new THREE.BoxGeometry(0.1, 0.45, 0.5); l1.translate(-0.7, 0.225, 0);
    var l2 = new THREE.BoxGeometry(0.1, 0.45, 0.5); l2.translate( 0.7, 0.225, 0);
    var unit = this._mergeGeoms([
      this._colorize(seat, wood), this._colorize(back, wood),
      this._colorize(l1, white), this._colorize(l2, white)
    ]);
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    var rng = this.rng;
    this._placeInstanced(unit, mat, pts, function () { return { ry: (rng() < 0.5 ? 0 : Math.PI) + (rng()-0.5)*0.4 }; });
  },

  // 旗帜：细杆 + 紫色竖幅(顶点色合并单元)
  _buildBanners: function (pts) {
    if (!pts.length) return;
    var pole = new THREE.CylinderGeometry(0.05, 0.05, 4, 6); pole.translate(0, 2, 0);
    var flag = new THREE.BoxGeometry(0.06, 1.6, 0.9); flag.translate(0, 3.0, 0.5);
    var poleC = this._vc(this.C.bannerPole), flagC = this._vc(this.C.banner);
    var unit = this._mergeGeoms([ this._colorize(pole, poleC), this._colorize(flag, flagC) ]);
    var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    var rng = this.rng;
    this._placeInstanced(unit, mat, pts, function () { return { ry: rng() * Math.PI * 2 }; });
  }
});

/* 自动把 street-environment 挂到 #room（无需改 HTML） */
window.addEventListener("DOMContentLoaded", function () {
  var attach = function () {
    var r = document.querySelector("#room");
    if (r && !r.hasAttribute("street-environment")) r.setAttribute("street-environment", "");
  };
  var r = document.querySelector("#room");
  if (r) attach();
  else { var s = document.querySelector("a-scene"); if (s) s.addEventListener("loaded", attach); }
});

/* ============================================================
   tv-manager — 凝视电视屏幕开/关视频播放（多屏幕版）
   同时管理多块屏幕，每块独立维护视频/材质/进度环状态。
   屏幕配置通过 SCREEN_CONFIGS 数组定义：
     { name: "GLB节点名", src: "视频路径" }
   ============================================================ */
AFRAME.registerComponent("tv-manager", {
  schema: {
    fuseDur: { type: "number", default: 2000 }
  },

  /* ── 在此添加/删除屏幕 ── */
  SCREEN_CONFIGS: [
    { name: "screem",     src: "./assets/movie.mp4"  },
    { name: "screem001", src: "./assets/movie2.mp4" }
  ],

  init: function () {
    this.roomModel = null;

    // 每个屏幕的状态对象
    // { mesh, origMat, videoEl, videoTex, state, isGazing, gazeElapsed, ring, ringBg }
    this.screens = [];

    // 刚触发过的屏幕，必须移开视线后才能重新凝视
    this.lastScreen = null;

    this.ray     = new THREE.Raycaster();
    this.ray.far = 12;
    this._camWP  = new THREE.Vector3();
    this._camDir = new THREE.Vector3();

    this.el.addEventListener("model-loaded", this.onModelLoaded.bind(this));
  },

  /* ── 模型载入：按 SCREEN_CONFIGS 逐一查找 Mesh ── */
  onModelLoaded: function () {
    var model = this.el.getObject3D("mesh");
    if (!model) return;
    this.roomModel = model;

    var configs = this.SCREEN_CONFIGS;
    for (var i = 0; i < configs.length; i++) {
      var cfg  = configs[i];
      var mesh = this._findMesh(model, cfg.name);
      if (!mesh) {
        console.warn("[tv] ⚠️ 未找到屏幕节点:", cfg.name);
        continue;
      }
      console.log("[tv] 找到屏幕 Mesh:", cfg.name, "→", mesh.name);
      this.screens.push({
        cfg:         cfg,
        mesh:        mesh,
        origMat:     null,
        videoEl:     null,
        videoTex:    null,
        state:       "off",
        isGazing:    false,
        gazeElapsed: 0,
        ring:        null,
        ringBg:      null
      });
    }
    console.log("[tv] 已注册屏幕数:", this.screens.length);
  },

  _findMesh: function (model, name) {
    var found = null;
    // 优先：自身就是 Mesh（精确匹配名字）
    model.traverse(function (ch) {
      if (!found && ch.name === name && ch.isMesh) found = ch;
    });
    if (found) { console.log("[tv] _findMesh 精确 Mesh:", name, "→", found.name); return found; }
    // 次选：Object3D 容器，取第一个子 Mesh
    model.traverse(function (ch) {
      if (!found && ch.name === name) {
        ch.traverse(function (c) { if (!found && c.isMesh) found = c; });
      }
    });
    if (found) console.log("[tv] _findMesh 子 Mesh:", name, "→", found.name);
    // 兜底：打印所有节点名帮助排查
    if (!found) {
      console.warn("[tv] ⚠️ 未找到:", name, "，现有节点名含 'screem' 的：");
      model.traverse(function (ch) {
        if (ch.name && ch.name.toLowerCase().indexOf("screem") !== -1)
          console.log("   ", ch.name, "isMesh:", ch.isMesh);
      });
    }
    return found;
  },

  /* ── 进度环（每块屏幕独立一套，挂在相机上） ── */
  _ensureRing: function (s) {
    if (s.ring) return;
    var cam = document.querySelector("#cam").object3D;

    s.ringBg = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true,
        opacity: 0.4, side: THREE.DoubleSide, depthTest: false })
    );
    s.ringBg.renderOrder = 9996;
    s.ringBg.visible = false;
    cam.add(s.ringBg);

    s.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2, 0.001),
      new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true,
        opacity: 0.95, side: THREE.DoubleSide, depthTest: false })
    );
    s.ring.renderOrder = 9997;
    s.ring.visible = false;
    cam.add(s.ring);
  },

  _syncRing: function (s) {
    var ce = document.querySelector("[cursor]");
    if (!ce || !s.ring) return;
    var cz = ce.object3D.position.z, sc = Math.abs(cz);
    s.ringBg.position.set(0, 0, cz);        s.ringBg.scale.set(sc, sc, sc);
    s.ring.position.set(0, 0, cz + 0.001);  s.ring.scale.set(sc, sc, sc);
  },

  _showRing: function (s) {
    this._ensureRing(s);
    s.ring.material.color.setHex(s.state === "off" ? 0x00ccff : 0xff4444);
    s.ringBg.visible = true;
    s.ring.visible   = true;
    this._setRingPct(s, 0);
  },

  _hideRing: function (s) {
    if (!s.ring) return;
    s.ringBg.visible = false;
    s.ring.visible   = false;
  },

  _setRingPct: function (s, pct) {
    if (!s.ring) return;
    pct = Math.min(Math.max(pct, 0), 1);
    var ng = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2,
                                    Math.max(pct * Math.PI * 2, 0.001));
    s.ring.geometry.dispose();
    s.ring.geometry = ng;
    this._syncRing(s);
  },

  /* ── 开启某块屏幕 ── */
  _turnOn: function (s) {
    if (!s.mesh) return;
    var self = this;

    if (!s.videoEl) {
      var v = document.createElement("video");
      v.src         = s.cfg.src;
      v.loop        = true;
      v.muted       = false;
      v.playsInline = true;
      v.crossOrigin = "anonymous";
      v.style.display = "none";
      document.body.appendChild(v);
      s.videoEl = v;
    }

    s.videoEl.play().catch(function (e) {
      console.warn("[tv] 播放失败 (" + s.cfg.name + "):", e);
    });

    if (!s.videoTex) {
      s.videoTex = new THREE.VideoTexture(s.videoEl);
      s.videoTex.minFilter = THREE.LinearFilter;
      s.videoTex.magFilter = THREE.LinearFilter;
    }

    if (!s.origMat) s.origMat = s.mesh.material;

    var newMat = new THREE.MeshBasicMaterial({
      map: s.videoTex, side: THREE.DoubleSide
    });
    s.mesh.material = newMat;

    var applyUV = function () { self._applyCoverUV(s); };
    if (s.videoEl.readyState >= 1) applyUV();
    else s.videoEl.addEventListener("loadedmetadata", applyUV, { once: true });

    s.state = "on";
    console.log("[tv] 📺 开启:", s.cfg.name);
  },

  /* ── 关闭某块屏幕 ── */
  _turnOff: function (s) {
    if (s.videoEl) { s.videoEl.pause(); s.videoEl.currentTime = 0; }
    if (s.mesh && s.origMat) {
      if (s.mesh.material !== s.origMat) s.mesh.material.dispose();
      s.mesh.material = s.origMat;
    }
    s.state = "off";
    console.log("[tv] 📺 关闭:", s.cfg.name);
  },

  /* ── Cover 模式 UV 裁剪 ── */
  _applyCoverUV: function (s) {
    if (!s.videoEl || !s.videoTex || !s.mesh) return;
    var vidW = s.videoEl.videoWidth, vidH = s.videoEl.videoHeight;
    if (!vidW || !vidH) return;

    var geo = s.mesh.geometry;
    geo.computeBoundingBox();
    var box   = geo.boundingBox;
    var meshW = box.max.x - box.min.x;
    var meshH = box.max.y - box.min.y;
    if (meshW === 0 || meshH === 0) { meshW = 1; meshH = 1; }

    var meshAR = meshW / meshH, vidAR = vidW / vidH;
    var repeatX, repeatY, offsetX, offsetY;

    if (vidAR > meshAR) {
      repeatY = 1; repeatX = meshAR / vidAR;
      offsetX = (1 - repeatX) / 2; offsetY = 0;
    } else {
      repeatX = 1; repeatY = vidAR / meshAR;
      offsetX = 0; offsetY = (1 - repeatY) / 2;
    }

    s.videoTex.repeat.set(repeatX, repeatY);
    s.videoTex.offset.set(offsetX, offsetY);
    s.videoTex.needsUpdate = true;
    console.log("[tv] UV cover (" + s.cfg.name + "):",
                repeatX.toFixed(3), repeatY.toFixed(3),
                "offset:", offsetX.toFixed(3), offsetY.toFixed(3));
  },

  /* ── tick：对每块屏幕独立做凝视检测 ── */
  tick: function (time, delta) {
    if (!this.roomModel || !this.screens.length) return;

    var cam = document.querySelector("#cam");
    if (!cam) return;
    cam.object3D.getWorldPosition(this._camWP);
    cam.object3D.getWorldDirection(this._camDir);
    this._camDir.negate();

    this.ray.set(this._camWP, this._camDir);
    var hits = this.ray.intersectObject(this.roomModel, true);

    // 遍历所有命中，找第一个属于已注册屏幕的
    var hitScreen = null;
    for (var i = 0; i < hits.length; i++) {
      var hitObj = hits[i].object;
      for (var k = 0; k < this.screens.length; k++) {
        if (this.screens[k].mesh === hitObj) { hitScreen = this.screens[k]; break; }
      }
      if (hitScreen) break;
    }

    // 刚触发过的屏幕：必须先移开视线，才能再次凝视（同 teleport-manager 的 lastDisk）
    if (hitScreen && hitScreen === this.lastScreen) {
      // 视线还在 → 忽略，等移开
      return;
    }
    if (!hitScreen) this.lastScreen = null;   // 视线移开了 → 解锁

    for (var j = 0; j < this.screens.length; j++) {
      var s = this.screens[j];
      var gazing = (hitScreen === s);

      if (gazing) {
        if (!s.isGazing) {
          s.isGazing    = true;
          s.gazeElapsed = 0;
          this._showRing(s);
        }
        s.gazeElapsed += (delta || 16);
        this._setRingPct(s, s.gazeElapsed / this.data.fuseDur);

        if (s.gazeElapsed >= this.data.fuseDur) {
          this._hideRing(s);
          s.isGazing    = false;
          s.gazeElapsed = 0;
          this.lastScreen = s;             // 锁定：必须移开视线后才能再次触发
          if (s.state === "off") this._turnOn(s);
          else                   this._turnOff(s);
        }
      } else {
        if (s.isGazing) {
          s.isGazing    = false;
          s.gazeElapsed = 0;
          this._hideRing(s);
        }
      }
    }
  }
});


/* ============================================================
   audio-manager — 凝视音响播放/暂停在线音乐
   节点：studio（Object3D）→ 子级 mesh_598（Mesh）
   凝视 2秒开始播放，再次凝视 2秒暂停
   ============================================================ */
/* ============================================================
   audio-manager — 凝视音响播放/暂停本地音乐
   节点：studio（Object3D）→ 子级 mesh_598（Mesh）
   凝视 2秒开始播放，再次凝视 2秒暂停
   ============================================================ */
AFRAME.registerComponent("audio-manager", {
  schema: {
    studioName: { type: "string", default: "studio"  },
    fuseDur:    { type: "number", default: 2000       },
    // 替换为本地 assets 文件夹中的音乐
    musicSrc:   { type: "string", default: "./assets/music.mp3" }
  },
  
  init: function () {
    this.roomModel   = null;
    this.studioMesh  = null;   // mesh_598，用于射线命中

    this.state       = "off";  // off | on
    this.gazeElapsed = 0;
    this.isGazing    = false;

    this.audio       = null;   // HTMLAudioElement

    this.ray     = new THREE.Raycaster();
    this.ray.far = 10;
    this._camWP  = new THREE.Vector3();
    this._camDir = new THREE.Vector3();

    // 进度环
    this._ring   = null;
    this._ringBg = null;

    this.el.addEventListener("model-loaded", this.onModelLoaded.bind(this));
  },

  /* ── 找 studio 下的 mesh_598 ── */
  onModelLoaded: function () {
    var model = this.el.getObject3D("mesh");
    if (!model) return;
    this.roomModel = model;
    var self = this;

    model.traverse(function (ch) {
      if (!self.studioMesh && ch.name === self.data.studioName) {
        // 找子级第一个 Mesh
        ch.traverse(function (c) {
          if (!self.studioMesh && c.isMesh) {
            self.studioMesh = c;
            console.log("[audio] 音响 Mesh:", c.name);
          }
        });
        // 如果自己就是 Mesh
        if (!self.studioMesh && ch.isMesh) {
          self.studioMesh = ch;
          console.log("[audio] 音响 Mesh:", ch.name);
        }
      }
    });

    if (!this.studioMesh) console.warn("[audio] ⚠️ 未找到 studio 节点");

    // 提前创建 Audio，避免首次点击延迟
    this.audio = new Audio(this.data.musicSrc);
    this.audio.loop   = true;
    this.audio.volume = 0.8;
  },

  /* ── 进度环 ── */
  _ensureRing: function () {
    if (this._ring) return;
    var cam = document.querySelector("#cam").object3D;

    this._ringBg = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true,
        opacity: 0.4, side: THREE.DoubleSide, depthTest: false })
    );
    this._ringBg.renderOrder = 9996;
    this._ringBg.visible = false;
    cam.add(this._ringBg);

    this._ring = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2, 0.001),
      new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true,
        opacity: 0.95, side: THREE.DoubleSide, depthTest: false })
    );
    this._ring.renderOrder = 9997;
    this._ring.visible = false;
    cam.add(this._ring);
  },

  _syncRing: function () {
    var ce = document.querySelector("[cursor]");
    if (!ce || !this._ring) return;
    var cz = ce.object3D.position.z, s = Math.abs(cz);
    this._ringBg.position.set(0, 0, cz);       this._ringBg.scale.set(s, s, s);
    this._ring.position.set(0, 0, cz + 0.001); this._ring.scale.set(s, s, s);
  },

  _showRing: function () {
    this._ensureRing();
    // 绿色=播放，橙色=暂停
    this._ring.material.color.setHex(this.state === "off" ? 0x44ff88 : 0xff9922);
    this._ringBg.visible = true;
    this._ring.visible   = true;
    this._setPct(0);
  },

  _hideRing: function () {
    if (!this._ring) return;
    this._ringBg.visible = false;
    this._ring.visible   = false;
  },

  /* 游标快速变色：命中地鼠时闪烁黄色 */
  _flashCursor: function () {
    this._ensureRing();
    var ring = this._ring, ringBg = this._ringBg;
    var origColor = ring.material.color.getHex();

    // 瞬间亮黄
    ring.material.color.setHex(0xffee00);
    ringBg.visible = true;
    ring.visible   = true;
    this._setRingPct(1);

    // 80ms 后恢复隐藏
    setTimeout(function () {
      ring.material.color.setHex(origColor);
      ringBg.visible = false;
      ring.visible   = false;
    }, 80);
  },

  _setPct: function (pct) {
    if (!this._ring) return;
    pct = Math.min(Math.max(pct, 0), 1);
    var ng = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2,
                                    Math.max(pct * Math.PI * 2, 0.001));
    this._ring.geometry.dispose();
    this._ring.geometry = ng;
    this._syncRing();
  },

  /* ── 播放 / 暂停 ── */
  _play: function () {
    if (!this.audio) return;
    this.audio.play().catch(function(e) {
      console.warn("[audio] 播放失败:", e);
    });
    this.state = "on";
    console.log("[audio] 🎵 播放");
  },

  _pause: function () {
    if (!this.audio) return;
    this.audio.pause();
    this.state = "off";
    console.log("[audio] ⏸ 暂停");
  },

  /* ── tick ── */
  tick: function (time, delta) {
    if (!this.roomModel || !this.studioMesh) return;

    var cam = document.querySelector("#cam");
    if (!cam) return;
    cam.object3D.getWorldPosition(this._camWP);
    cam.object3D.getWorldDirection(this._camDir);
    this._camDir.negate();

    this.ray.set(this._camWP, this._camDir);
    var hits = this.ray.intersectObject(this.roomModel, true);

    var gazing = false;
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].object === this.studioMesh) { gazing = true; break; }
    }

    if (gazing) {
      if (!this.isGazing) {
        this.isGazing    = true;
        this.gazeElapsed = 0;
        this._showRing();
      }
      this.gazeElapsed += (delta || 16);
      this._setPct(this.gazeElapsed / this.data.fuseDur);

      if (this.gazeElapsed >= this.data.fuseDur) {
        this._hideRing();
        this.isGazing    = false;
        this.gazeElapsed = 0;
        if (this.state === "off") this._play();
        else                      this._pause();
      }
    } else {
      if (this.isGazing) {
        this.isGazing    = false;
        this.gazeElapsed = 0;
        this._hideRing();
      }
    }
  }
});

/* ============================================================
   whack-mole-manager — 电脑显示器打地鼠游戏
   - 凝视 keyboard 或 mouse 2 秒 → 开始/重开游戏
   - 游戏中凝视屏幕上的地鼠 1.2 秒 → 打中得分
   - 游戏时长 10 秒，结束后凝视键盘/鼠标重新开始
   ============================================================ */
AFRAME.registerComponent("whack-mole-manager", {
  schema: {
    screenName:   { type: "string", default: "computer_screen" },
    keyboardName: { type: "string", default: "keyboard"        },
    mouseName:    { type: "string", default: "mouse"           },
    gazeDur:      { type: "number", default: 2000  },   // 开始游戏凝视时长
    hitDur:       { type: "number", default: 0     },   // 打中地鼠凝视时长（瞬间）
    gameDur:      { type: "number", default: 20000 },   // 游戏时长 ms
    moleCount:    { type: "number", default: 9     }    // 洞的数量
  },

  init: function () {
    this.roomModel  = null;
    this.screenMesh = null;
    this.origMat    = null;

    // Canvas & Texture
    this.canvas  = null;
    this.ctx     = null;
    this.canvasTex = null;

    // 游戏状态: idle | playing | gameover
    this.gameState   = "idle";
    this.score       = 0;
    this.timeLeft    = 0;
    this.gameTimer   = null;
    this.moleTimers  = [];

    // 洞格子（3×3），每个洞: { x, y, r, active, hitPct }
    this.holes = [];

    // 键盘 & 鼠标 Mesh
    this.keyboardMesh = null;
    this.mouseMesh    = null;

    // 凝视状态
    this.isGazing    = false;
    this.gazeElapsed = 0;
    this.gazeTarget  = null;   // null | "keyboard" | "mouse" | hole对象
    this.lastTarget  = null;   // 触发后锁定，需移开才能再触发

    // 进度环
    this._ring   = null;
    this._ringBg = null;

    // 射线
    this.ray     = new THREE.Raycaster();
    this.ray.far = 8;
    this._camWP  = new THREE.Vector3();
    this._camDir = new THREE.Vector3();

    // UV 采样用（把世界射线转成屏幕 UV）
    this._hitPt  = new THREE.Vector3();
    this._invMat = new THREE.Matrix4();

    this.el.addEventListener("model-loaded", this.onModelLoaded.bind(this));
  },

  /* ── 找屏幕 Mesh ── */
  onModelLoaded: function () {
    var model = this.el.getObject3D("mesh");
    if (!model) return;
    this.roomModel = model;
    var name = this.data.screenName;
    var found = null;

    model.traverse(function (ch) {
      if (!found && ch.name === name && ch.isMesh) found = ch;
    });
    if (!found) {
      model.traverse(function (ch) {
        if (!found && ch.name === name) {
          ch.traverse(function (c) { if (!found && c.isMesh) found = c; });
        }
      });
    }
    if (!found) {
      // 兜底：打印含关键词的节点
      console.warn("[mole] ⚠️ 未找到:", name);
      model.traverse(function (ch) {
        if (ch.name && ch.name.toLowerCase().indexOf("computer") !== -1)
          console.log("   节点:", ch.name, "isMesh:", ch.isMesh);
      });
      return;
    }
    this.screenMesh = found;
    console.log("[mole] 找到屏幕:", found.name);

    // 找键盘 & 鼠标 Mesh（兜底：名字含关键词则取第一个 Mesh）
    var kName = this.data.keyboardName, mName = this.data.mouseName;
    var kFound = null, mFound = null;
    model.traverse(function (ch) {
      if (!kFound && ch.name === kName && ch.isMesh) kFound = ch;
      if (!mFound && ch.name === mName && ch.isMesh) mFound = ch;
    });
    // Object3D 容器兜底
    model.traverse(function (ch) {
      if (!kFound && ch.name === kName) ch.traverse(function(c){ if(!kFound && c.isMesh) kFound=c; });
      if (!mFound && ch.name === mName) ch.traverse(function(c){ if(!mFound && c.isMesh) mFound=c; });
    });
    // 关键词模糊兜底
    if (!kFound || !mFound) {
      model.traverse(function (ch) {
        if (!kFound && ch.isMesh && ch.name.toLowerCase().indexOf("keyboard") !== -1) kFound = ch;
        if (!mFound && ch.isMesh && ch.name.toLowerCase().indexOf("mouse")    !== -1) mFound = ch;
      });
    }
    this.keyboardMesh = kFound;
    this.mouseMesh    = mFound;
    console.log("[mole] 键盘:", kFound ? kFound.name : "未找到",
                " 鼠标:", mFound ? mFound.name : "未找到");

    this._initCanvas();
    this._applyCanvas();
    this._drawIdle();
  },

  /* ── 创建 Canvas（固定分辨率） ── */
  _initCanvas: function () {
    this.canvas = document.createElement("canvas");
    this.canvas.width  = 512;
    this.canvas.height = 320;
    this.ctx = this.canvas.getContext("2d");

    // 洞位布局 3×3
    var cols = 3, rows = 3;
    var pw = this.canvas.width, ph = this.canvas.height;
    var padX = 60, padY = 50;
    var cellW = (pw - padX * 2) / cols;
    var cellH = (ph - padY * 2) / rows;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        this.holes.push({
          x: padX + cellW * c + cellW / 2,
          y: padY + cellH * r + cellH / 2,
          r: 28,
          active: false,
          hitPct: 0,
          timer: null
        });
      }
    }
  },

  /* ── 把 Canvas 贴到屏幕 Mesh ── */
  _applyCanvas: function () {
    if (!this.screenMesh) return;
    if (!this.origMat) this.origMat = this.screenMesh.material;

    this.canvasTex = new THREE.CanvasTexture(this.canvas);
    this.canvasTex.minFilter = THREE.LinearFilter;
    this.canvasTex.magFilter = THREE.LinearFilter;

    this.screenMesh.material = new THREE.MeshBasicMaterial({
      map: this.canvasTex,
      side: THREE.DoubleSide
    });
  },

  /* ── 刷新 Canvas 纹理 ── */
  _flush: function () {
    if (this.canvasTex) this.canvasTex.needsUpdate = true;
  },

  /* ════════════════ 绘制函数 ════════════════ */

  _drawIdle: function () {
    var ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    // 镜像修正（GLB UV X 轴翻转）
    ctx.setTransform(-1, 0, 0, -1, w, h);
    // 背景
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(0, 0, w, h);

    // 网格装饰
    ctx.strokeStyle = "rgba(100,180,255,0.08)";
    ctx.lineWidth = 1;
    for (var i = 0; i < w; i += 32) { ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,h); ctx.stroke(); }
    for (var j = 0; j < h; j += 32) { ctx.beginPath(); ctx.moveTo(0,j); ctx.lineTo(w,j); ctx.stroke(); }

    // 标题
    ctx.fillStyle = "#00e5ff";
    ctx.font = "bold 36px Arial";
    ctx.textAlign = "center";
    ctx.shadowColor = "#00e5ff";
    ctx.shadowBlur  = 12;
    ctx.fillText("WHACK-A-MOLE", w/2, 90);
    ctx.shadowBlur = 0;

    // 副标题
    ctx.fillStyle = "#ffffff";
    ctx.font = "16px Arial";
    ctx.fillText("凝视键盘或鼠标 2 秒开始游戏", w/2, 130);

    // 洞（待机样式）
    this._drawHoles(false);

    this._flush();
  },

  _drawGame: function () {
    var ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(-1, 0, 0, -1, w, h);
    ctx.fillStyle = "#0f0f1e";
    ctx.fillRect(0, 0, w, h);

    // 顶栏
    ctx.fillStyle = "#00e5ff";
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "left";
    ctx.fillText("得分: " + this.score, 20, 28);

    var sec = Math.ceil(this.timeLeft / 1000);
    ctx.textAlign = "right";
    ctx.fillStyle = sec <= 5 ? "#ff4444" : "#ffffff";
    ctx.fillText("⏱ " + sec + "s", w - 20, 28);

    this._drawHoles(true);
    this._flush();
  },

  _drawGameOver: function () {
    var ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.setTransform(-1, 0, 0, -1, w, h);
    ctx.fillStyle = "#0f0f1e";
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "#ff4444";
    ctx.font = "bold 38px Arial";
    ctx.textAlign = "center";
    ctx.shadowColor = "#ff4444";
    ctx.shadowBlur  = 14;
    ctx.fillText("GAME OVER", w/2, 100);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px Arial";
    ctx.fillText("得分: " + this.score, w/2, 148);

    // 评价
    var msg = this.score >= 15 ? "🏆 大师级！" :
              this.score >= 10 ? "⭐ 不错！" :
              this.score >= 5  ? "👍 继续练习" : "😅 再来一次";
    ctx.font = "20px Arial";
    ctx.fillStyle = "#ffdd44";
    ctx.fillText(msg, w/2, 185);

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "15px Arial";
    ctx.fillText("凝视键盘或鼠标 2 秒重新开始", w/2, 225);

    this._flush();
  },

  _drawHoles: function (active) {
    var ctx = this.ctx;
    for (var i = 0; i < this.holes.length; i++) {
      var h = this.holes[i];

      // 洞（椭圆阴影）
      ctx.fillStyle = "#000000";
      ctx.beginPath();
      ctx.ellipse(h.x, h.y + h.r * 0.3, h.r * 1.1, h.r * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();

      if (active && h.active) {
        // 地鼠出现动画（从洞里冒出）
        var pop = 1 - h.hitPct;   // hitPct 0→1 = 被打过程，pop 反向
        var moleY = h.y - h.r * 0.6 * pop;
        var moleR = h.r * 0.82;

        // 身体
        var grad = ctx.createRadialGradient(h.x - moleR*0.2, moleY - moleR*0.2, 2, h.x, moleY, moleR);
        grad.addColorStop(0, "#c87941");
        grad.addColorStop(1, "#7a4a20");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(h.x, moleY, moleR, 0, Math.PI * 2);
        ctx.fill();

        // 眼睛
        ctx.fillStyle = "#ffffff";
        ctx.beginPath(); ctx.arc(h.x - 7, moleY - 6, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(h.x + 7, moleY - 6, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#222";
        ctx.beginPath(); ctx.arc(h.x - 7, moleY - 6, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(h.x + 7, moleY - 6, 2.5, 0, Math.PI * 2); ctx.fill();

        // 鼻子
        ctx.fillStyle = "#ff8888";
        ctx.beginPath(); ctx.arc(h.x, moleY + 2, 3.5, 0, Math.PI * 2); ctx.fill();

        // 凝视进度弧（命中时显示）
        if (h.hitPct > 0) {
          ctx.strokeStyle = "#ffdd00";
          ctx.lineWidth   = 4;
          ctx.beginPath();
          ctx.arc(h.x, moleY, moleR + 5, -Math.PI/2, -Math.PI/2 + Math.PI*2*h.hitPct);
          ctx.stroke();
        }

      } else if (active) {
        // 空洞
        ctx.fillStyle = "rgba(80,50,20,0.6)";
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * 0.75, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // 待机：只画装饰圈
        ctx.strokeStyle = "rgba(100,180,255,0.25)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(h.x, h.y, h.r * 0.75, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  },

  /* ════════════════ 游戏逻辑 ════════════════ */

  _startGame: function () {
    var self = this;
    this.score     = 0;
    this.timeLeft  = this.data.gameDur;
    this.gameState = "playing";

    // 清空所有洞
    for (var i = 0; i < this.holes.length; i++) {
      this.holes[i].active = false;
      this.holes[i].hitPct = 0;
      if (this.holes[i].timer) { clearTimeout(this.holes[i].timer); this.holes[i].timer = null; }
    }

    // 倒计时
    this.gameTimer = setInterval(function () {
      self.timeLeft -= 200;
      if (self.timeLeft <= 0) {
        self.timeLeft = 0;
        self._endGame();
      }
    }, 200);

    // 地鼠出没
    this._scheduleMole();
    console.log("[mole] 🎮 游戏开始");
  },

  _scheduleMole: function () {
    if (this.gameState !== "playing") return;
    var self = this;
    var delay = 600 + Math.random() * 800;
    setTimeout(function () {
      if (self.gameState !== "playing") return;

      // 随机选一个空洞
      var empty = [];
      for (var i = 0; i < self.holes.length; i++) {
        if (!self.holes[i].active) empty.push(i);
      }
      if (!empty.length) { self._scheduleMole(); return; }
      var idx = empty[Math.floor(Math.random() * empty.length)];
      var hole = self.holes[idx];
      hole.active = true;
      hole.hitPct = 0;

      // 地鼠停留时长
      var stayDur = 1800 + Math.random() * 1200;
      hole.timer = setTimeout(function () {
        hole.active = false;
        hole.hitPct = 0;
        self._scheduleMole();
      }, stayDur);

    }, delay);
  },

  _hitMole: function (hole) {
    if (hole.timer) { clearTimeout(hole.timer); hole.timer = null; }
    hole.active = false;
    hole.hitPct = 0;
    this.score++;
    console.log("[mole] 🔨 打中！得分:", this.score);
    this._scheduleMole();
  },

  _endGame: function () {
    clearInterval(this.gameTimer);
    this.gameTimer = null;
    for (var i = 0; i < this.holes.length; i++) {
      this.holes[i].active = false;
      if (this.holes[i].timer) { clearTimeout(this.holes[i].timer); this.holes[i].timer = null; }
    }
    this.gameState = "gameover";
    this._drawGameOver();
    console.log("[mole] 🏁 游戏结束，得分:", this.score);
  },

  /* ════════════════ 进度环 ════════════════ */
  _ensureRing: function () {
    if (this._ring) return;
    var cam = document.querySelector("#cam").object3D;

    this._ringBg = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true,
        opacity: 0.4, side: THREE.DoubleSide, depthTest: false })
    );
    this._ringBg.renderOrder = 9996;
    this._ringBg.visible = false;
    cam.add(this._ringBg);

    this._ring = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2, 0.001),
      new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true,
        opacity: 0.95, side: THREE.DoubleSide, depthTest: false })
    );
    this._ring.renderOrder = 9997;
    this._ring.visible = false;
    cam.add(this._ring);
  },

  _syncRing: function () {
    var ce = document.querySelector("[cursor]");
    if (!ce || !this._ring) return;
    var cz = ce.object3D.position.z, s = Math.abs(cz);
    this._ringBg.position.set(0, 0, cz);        this._ringBg.scale.set(s, s, s);
    this._ring.position.set(0, 0, cz + 0.001);  this._ring.scale.set(s, s, s);
  },

  _showRing: function (color) {
    this._ensureRing();
    this._ring.material.color.setHex(color || 0xffdd00);
    this._ringBg.visible = true;
    this._ring.visible   = true;
    this._setRingPct(0);
  },

  _hideRing: function () {
    if (!this._ring) return;
    this._ringBg.visible = false;
    this._ring.visible   = false;
  },

  /* 游标快速变色：命中地鼠时闪烁黄色 */
  _flashCursor: function () {
    this._ensureRing();
    var ring = this._ring, ringBg = this._ringBg;
    var origColor = ring.material.color.getHex();

    // 瞬间亮黄
    ring.material.color.setHex(0xffee00);
    ringBg.visible = true;
    ring.visible   = true;
    this._setRingPct(1);

    // 80ms 后恢复隐藏
    setTimeout(function () {
      ring.material.color.setHex(origColor);
      ringBg.visible = false;
      ring.visible   = false;
    }, 80);
  },

  _setRingPct: function (pct) {
    if (!this._ring) return;
    pct = Math.min(Math.max(pct, 0), 1);
    var ng = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2,
                                    Math.max(pct * Math.PI * 2, 0.001));
    this._ring.geometry.dispose();
    this._ring.geometry = ng;
    this._syncRing();
  },

  /* ════════════════ UV 命中检测 ════════════════ */
  /* 把射线命中点转为 Canvas 上的 (cx, cy)，判断是否在某个洞里 */
  _getHitHole: function (hit) {
    if (!this.screenMesh || !hit) return null;

    // 用 UV 坐标直接定位
    var uv = hit.uv;
    if (!uv) return null;

    var cx = (1 - uv.x) * this.canvas.width;
    var cy = uv.y * this.canvas.height;

    for (var i = 0; i < this.holes.length; i++) {
      var h = this.holes[i];
      if (!h.active) continue;
      var dx = cx - h.x, dy = cy - h.y;
      if (dx*dx + dy*dy < (h.r * 1.1) * (h.r * 1.1)) return h;
    }
    return null;
  },

  /* ════════════════ tick ════════════════ */
  tick: function (time, delta) {
    if (!this.roomModel || !this.screenMesh) return;

    var cam = document.querySelector("#cam");
    if (!cam) return;
    cam.object3D.getWorldPosition(this._camWP);
    cam.object3D.getWorldDirection(this._camDir);
    this._camDir.negate();

    this.ray.set(this._camWP, this._camDir);
    var hits = this.ray.intersectObject(this.roomModel, true);

    // 游戏运行中：每帧刷新画面
    if (this.gameState === "playing") this._drawGame();

    // ── 判断凝视目标 ──
    var gazeTarget = null;

    if (this.gameState === "playing") {
      // 游戏中：只响应屏幕上的地鼠
      for (var i = 0; i < hits.length; i++) {
        if (hits[i].object === this.screenMesh) {
          var hole = this._getHitHole(hits[i]);
          if (hole) { gazeTarget = hole; }
          break;
        }
      }
    } else {
      // idle / gameover：响应键盘或鼠标
      for (var j = 0; j < hits.length; j++) {
        var obj = hits[j].object;
        if (this.keyboardMesh && obj === this.keyboardMesh) { gazeTarget = "keyboard"; break; }
        if (this.mouseMesh    && obj === this.mouseMesh)    { gazeTarget = "mouse";    break; }
      }
    }

    // lastTarget 锁：触发后必须移开视线才能再次触发
    if (gazeTarget && gazeTarget === this.lastTarget) return;
    if (!gazeTarget) this.lastTarget = null;

    if (gazeTarget) {
      var isPeripheral = (gazeTarget === "keyboard" || gazeTarget === "mouse");

      if (isPeripheral) {
        // ── 键盘/鼠标：读条凝视 ──
        if (gazeTarget !== this.gazeTarget) {
          this.gazeTarget  = gazeTarget;
          this.gazeElapsed = 0;
          this.isGazing    = true;
          this._showRing(0x44ff88);
        }
        this.gazeElapsed += (delta || 16);
        this._setRingPct(this.gazeElapsed / this.data.gazeDur);

        if (this.gazeElapsed >= this.data.gazeDur) {
          this._hideRing();
          this.isGazing   = false;
          this.gazeTarget = null;
          this.lastTarget = gazeTarget;
          this._startGame();
        }

      } else {
        // ── 地鼠：瞬间打中，游标快速变色 ──
        if (gazeTarget !== this.gazeTarget) {
          this.gazeTarget  = gazeTarget;
          this.gazeElapsed = 0;
          this.isGazing    = true;
        }
        this.gazeElapsed += (delta || 16);

        if (this.gazeElapsed >= this.data.hitDur + 16) {
          this.isGazing   = false;
          this.gazeTarget = null;
          this.lastTarget = gazeTarget;
          this._flashCursor();
          this._hitMole(gazeTarget);
        }
      }

    } else {
      if (this.isGazing) {
        this.isGazing    = false;
        this.gazeTarget  = null;
        this.gazeElapsed = 0;
        this._hideRing();
      }
    }
  }
});


/* ============================================================
   alarm-manager — 凝视闹钟触发/关闭响铃
   - 节点名 alarm（GLB 中与 Blender 一致）
   - 凝视 2 秒开始响铃，再次凝视 2 秒关闭
   - 响铃用 Web Audio API 合成，无需外部音频文件
   ============================================================ */
AFRAME.registerComponent("alarm-manager", {
  schema: {
    alarmName: { type: "string", default: "alarm" },
    fuseDur:   { type: "number", default: 2000    }
  },

  init: function () {
    this.roomModel  = null;
    this.alarmMesh  = null;

    this.state       = "off";
    this.isGazing    = false;
    this.gazeElapsed = 0;
    this.lastTarget  = false;

    this.audioCtx    = null;
    this.alarmNodes  = [];   // 当前响铃的音频节点

    this.ray     = new THREE.Raycaster();
    this.ray.far = 8;
    this._camWP  = new THREE.Vector3();
    this._camDir = new THREE.Vector3();

    this._ring   = null;
    this._ringBg = null;

    this.el.addEventListener("model-loaded", this.onModelLoaded.bind(this));
  },

  onModelLoaded: function () {
    var model = this.el.getObject3D("mesh");
    if (!model) return;
    this.roomModel = model;
    var name = this.data.alarmName;
    var found = null;

    model.traverse(function (ch) {
      if (!found && ch.name === name && ch.isMesh) found = ch;
    });
    if (!found) {
      model.traverse(function (ch) {
        if (!found && ch.name === name)
          ch.traverse(function (c) { if (!found && c.isMesh) found = c; });
      });
    }
    if (!found) {
      console.warn("[alarm] ⚠️ 未找到节点:", name, "，打印含 alarm 的节点：");
      model.traverse(function (ch) {
        if (ch.name && ch.name.toLowerCase().indexOf("alarm") !== -1)
          console.log("   ", ch.name, "isMesh:", ch.isMesh);
      });
      return;
    }
    this.alarmMesh = found;
    console.log("[alarm] 找到闹钟:", found.name);
  },

  /* ── 本地音频文件播放闹铃 ── */
  _startAlarm: function () {
    if (!this.audio) {
      this.audio = new Audio("./assets/music2.mp3");
      this.audio.loop   = true;
      this.audio.volume = 1.0;
    }
    this.audio.currentTime = 0;
    this.audio.play().catch(function(e) {
      console.warn("[alarm] 播放失败:", e);
    });
    this.state = "on";
    console.log("[alarm] 🔔 响铃开始");
  },

  _stopAlarm: function () {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this.state = "off";
    console.log("[alarm] 🔕 响铃关闭");
  },

  /* ── 进度环 ── */
  _ensureRing: function () {
    if (this._ring) return;
    var cam = document.querySelector("#cam").object3D;

    this._ringBg = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48),
      new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true,
        opacity: 0.4, side: THREE.DoubleSide, depthTest: false })
    );
    this._ringBg.renderOrder = 9996;
    this._ringBg.visible = false;
    cam.add(this._ringBg);

    this._ring = new THREE.Mesh(
      new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2, 0.001),
      new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true,
        opacity: 0.95, side: THREE.DoubleSide, depthTest: false })
    );
    this._ring.renderOrder = 9997;
    this._ring.visible = false;
    cam.add(this._ring);
  },

  _syncRing: function () {
    var ce = document.querySelector("[cursor]");
    if (!ce || !this._ring) return;
    var cz = ce.object3D.position.z, s = Math.abs(cz);
    this._ringBg.position.set(0, 0, cz);        this._ringBg.scale.set(s, s, s);
    this._ring.position.set(0, 0, cz + 0.001);  this._ring.scale.set(s, s, s);
  },

  _showRing: function () {
    this._ensureRing();
    // 橙色=开启响铃，蓝色=关闭响铃
    this._ring.material.color.setHex(this.state === "off" ? 0xff6600 : 0x4499ff);
    this._ringBg.visible = true;
    this._ring.visible   = true;
    this._setRingPct(0);
  },

  _hideRing: function () {
    if (!this._ring) return;
    this._ringBg.visible = false;
    this._ring.visible   = false;
  },

  _setRingPct: function (pct) {
    if (!this._ring) return;
    pct = Math.min(Math.max(pct, 0), 1);
    var ng = new THREE.RingGeometry(0.019, 0.03, 48, 1, Math.PI / 2,
                                    Math.max(pct * Math.PI * 2, 0.001));
    this._ring.geometry.dispose();
    this._ring.geometry = ng;
    this._syncRing();
  },

  /* ── tick ── */
  tick: function (time, delta) {
    if (!this.roomModel || !this.alarmMesh) return;

    var cam = document.querySelector("#cam");
    if (!cam) return;
    cam.object3D.getWorldPosition(this._camWP);
    cam.object3D.getWorldDirection(this._camDir);
    this._camDir.negate();

    this.ray.set(this._camWP, this._camDir);
    var hits = this.ray.intersectObject(this.roomModel, true);

    var gazing = false;
    for (var i = 0; i < hits.length; i++) {
      if (hits[i].object === this.alarmMesh) { gazing = true; break; }
    }

    // lastTarget 锁：触发后先移开视线才能再次触发
    if (gazing && this.lastTarget) return;
    if (!gazing) this.lastTarget = false;

    if (gazing) {
      if (!this.isGazing) {
        this.isGazing    = true;
        this.gazeElapsed = 0;
        this._showRing();
      }
      this.gazeElapsed += (delta || 16);
      this._setRingPct(this.gazeElapsed / this.data.fuseDur);

      if (this.gazeElapsed >= this.data.fuseDur) {
        this._hideRing();
        this.isGazing    = false;
        this.gazeElapsed = 0;
        this.lastTarget  = true;
        if (this.state === "off") this._startAlarm();
        else                      this._stopAlarm();
      }
    } else {
      if (this.isGazing) {
        this.isGazing    = false;
        this.gazeElapsed = 0;
        this._hideRing();
      }
    }
  }
});


/* ============================================================
   outdoor-town
   A lightweight low-poly street scene around room.glb.
   The measured room footprint is kept clear:
   x approx -7.7..11.9, z approx -5.8..4.7.
   ============================================================ */
AFRAME.registerComponent("outdoor-town", {
  schema: {
    groundY:   { type: "number", default: 0 },
    houseMinX: { type: "number", default: -8.5 },
    houseMaxX: { type: "number", default: 12.8 },
    houseMinZ: { type: "number", default: -6.8 },
    houseMaxZ: { type: "number", default: 5.7 }
  },

  init: function () {
    this.group = new THREE.Group();
    this.group.name = "outdoor-town-root";
    this.el.object3D.add(this.group);
    this.mats = {};
    this._build();
  },

  remove: function () {
    if (!this.group) return;
    this.el.object3D.remove(this.group);
    this.group.traverse(function (obj) {
      if (obj.geometry) obj.geometry.dispose();
    });
    for (var k in this.mats) {
      if (this.mats[k]) this.mats[k].dispose();
    }
    this.group = null;
    this.mats = {};
  },

  _mat: function (key, color, opts) {
    if (this.mats[key]) return this.mats[key];
    opts = opts || {};
    var params = {
      color: new THREE.Color(color),
      roughness: opts.roughness == null ? 0.86 : opts.roughness,
      metalness: opts.metalness == null ? 0.02 : opts.metalness,
      flatShading: opts.flatShading !== false
    };
    if (opts.transparent) {
      params.transparent = true;
      params.opacity = opts.opacity == null ? 0.72 : opts.opacity;
      params.depthWrite = opts.depthWrite !== false;
    }
    if (opts.emissive) {
      params.emissive = new THREE.Color(opts.emissive);
      params.emissiveIntensity = opts.emissiveIntensity == null ? 0.35 : opts.emissiveIntensity;
    }
    this.mats[key] = new THREE.MeshStandardMaterial(params);
    return this.mats[key];
  },

  _mesh: function (name, geometry, matKey, color, opts) {
    var mesh = new THREE.Mesh(geometry, this._mat(matKey, color, opts));
    mesh.name = name;
    mesh.frustumCulled = true;
    this.group.add(mesh);
    return mesh;
  },

  _box: function (name, x, y, z, w, h, d, matKey, color, rotY) {
    var mesh = this._mesh(name, new THREE.BoxGeometry(w, h, d), matKey, color);
    mesh.position.set(x, y + h * 0.5, z);
    if (rotY) mesh.rotation.y = rotY;
    return mesh;
  },

  _cylinder: function (name, x, y, z, rTop, rBot, h, matKey, color, segments) {
    var mesh = this._mesh(
      name,
      new THREE.CylinderGeometry(rTop, rBot, h, segments || 12),
      matKey,
      color
    );
    mesh.position.set(x, y + h * 0.5, z);
    return mesh;
  },

  _sphere: function (name, x, y, z, r, matKey, color, sx, sy, sz, opts) {
    var mesh = this._mesh(
      name,
      new THREE.SphereGeometry(r, 12, 8),
      matKey,
      color,
      opts
    );
    mesh.position.set(x, y, z);
    mesh.scale.set(sx || 1, sy || 1, sz || 1);
    return mesh;
  },

  _cone: function (name, x, y, z, r, h, matKey, color, segments) {
    var mesh = this._mesh(
      name,
      new THREE.ConeGeometry(r, h, segments || 10),
      matKey,
      color
    );
    mesh.position.set(x, y + h * 0.5, z);
    return mesh;
  },

  _torus: function (name, x, y, z, radius, tube, matKey, color, rotX, rotY, rotZ) {
    var mesh = this._mesh(
      name,
      new THREE.TorusGeometry(radius, tube, 8, 24),
      matKey,
      color
    );
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX || 0, rotY || 0, rotZ || 0);
    return mesh;
  },

  _gableRoof: function (name, x, y, z, w, h, d, matKey, color, rotY) {
    var p = [
      -w / 2, 0, -d / 2,  w / 2, 0, -d / 2,  0, h, -d / 2,
      -w / 2, 0,  d / 2,  w / 2, 0,  d / 2,  0, h,  d / 2
    ];
    var idx = [
      0, 1, 2, 3, 5, 4,
      0, 2, 5, 0, 5, 3,
      1, 4, 5, 1, 5, 2,
      0, 3, 4, 0, 4, 1
    ];
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    var mesh = this._mesh(name, geo, matKey, color);
    mesh.position.set(x, y, z);
    if (rotY) mesh.rotation.y = rotY;
    return mesh;
  },

  _build: function () {
    this._buildGroundAndRoads();
    this._buildHouseFrontYard();
    this._buildShops();
    this._buildCanalAndBridge();
    this._buildStreetFurniture();
    this._buildPlanting();
    this._buildSkyDetails();
    this._freezeStaticMeshes();
  },

  _freezeStaticMeshes: function () {
    this.group.traverse(function (obj) {
      if (!obj.isMesh) return;
      obj.updateMatrix();
      obj.matrixAutoUpdate = false;
    });
  },

  _buildGroundAndRoads: function () {
    var gy = this.data.groundY;

    this._box("grass-front-near", 0, gy - 0.08, 17.5, 76, 0.08, 24.0, "grass", "#8edc78");
    this._box("grass-front-far", 0, gy - 0.08, 39.0, 76, 0.08, 8.0, "grass", "#8edc78");
    this._box("grass-back", 0, gy - 0.08, -22.0, 76, 0.08, 30.0, "grass", "#82d772");
    this._box("grass-left", -25.0, gy - 0.08, -0.7, 32, 0.08, 13.0, "grass", "#8edc78");
    this._box("grass-right", 28.0, gy - 0.08, -0.7, 30, 0.08, 13.0, "grass", "#8edc78");

    this._box("main-road", 0, gy, 12.5, 76, 0.05, 6.0, "road", "#5f5550");
    this._box("left-road-near", -17.0, gy, 7.25, 5.6, 0.05, 3.7, "road", "#5f5550");
    this._box("left-road-far", -17.0, gy, 22.65, 5.6, 0.05, 13.5, "road", "#5f5550");
    this._box("right-road-near", 18.0, gy, 7.25, 5.6, 0.05, 3.7, "road", "#5f5550");
    this._box("right-road-far", 18.0, gy, 22.65, 5.6, 0.05, 13.5, "road", "#5f5550");
    this._box("right-road-beyond-bridge", 18.0, gy, 38.7, 5.6, 0.05, 6.4, "road", "#5f5550");

    this._sidewalkRun("sidewalk-near", 8.65);
    this._sidewalkRun("sidewalk-far", 16.35);
    this._box("left-walk-west", -20.25, gy + 0.02, 22.6, 1.0, 0.06, 13.1, "sidewalk", "#f1ead8");
    this._box("left-walk-east", -13.75, gy + 0.02, 22.6, 1.0, 0.06, 13.1, "sidewalk", "#f1ead8");
    this._box("right-walk-west", 14.75, gy + 0.02, 22.6, 1.0, 0.06, 13.1, "sidewalk", "#f1ead8");
    this._box("right-walk-east", 21.25, gy + 0.02, 22.6, 1.0, 0.06, 13.1, "sidewalk", "#f1ead8");

    this._laneMarks(-34, 34, 12.5);
    this._crosswalk(-17.0, 9.15, false);
    this._crosswalk(18.0, 9.15, false);
    this._crosswalk(-17.0, 15.85, false);
    this._crosswalk(18.0, 15.85, false);
  },

  _sidewalkRun: function (name, z) {
    var gy = this.data.groundY;
    this._box(name + "-a", -29.0, gy + 0.02, z, 18.0, 0.06, 1.1, "sidewalk", "#f1ead8");
    this._box(name + "-b", 0.4, gy + 0.02, z, 26.4, 0.06, 1.1, "sidewalk", "#f1ead8");
    this._box(name + "-c", 29.4, gy + 0.02, z, 16.8, 0.06, 1.1, "sidewalk", "#f1ead8");
    this._box(name + "-curb-a", -29.0, gy + 0.08, z - 0.64, 18.0, 0.12, 0.18, "curb", "#fbf8ec");
    this._box(name + "-curb-b", 0.4, gy + 0.08, z - 0.64, 26.4, 0.12, 0.18, "curb", "#fbf8ec");
    this._box(name + "-curb-c", 29.4, gy + 0.08, z - 0.64, 16.8, 0.12, 0.18, "curb", "#fbf8ec");
    this._box(name + "-curb-d", -29.0, gy + 0.08, z + 0.64, 18.0, 0.12, 0.18, "curb", "#fbf8ec");
    this._box(name + "-curb-e", 0.4, gy + 0.08, z + 0.64, 26.4, 0.12, 0.18, "curb", "#fbf8ec");
    this._box(name + "-curb-f", 29.4, gy + 0.08, z + 0.64, 16.8, 0.12, 0.18, "curb", "#fbf8ec");
  },

  _laneMarks: function (x1, x2, z) {
    for (var x = x1; x <= x2; x += 8) {
      this._box("lane-mark-" + x, x, 0.055, z, 3.0, 0.012, 0.16, "lane", "#f8e9a5");
    }
  },

  _crosswalk: function (x, z, vertical) {
    for (var i = -2; i <= 2; i++) {
      if (vertical) {
        this._box("crosswalk-v-" + x + "-" + i, x + i * 0.45, 0.06, z, 0.22, 0.012, 2.6, "crosswalk", "#f8f5ec");
      } else {
        this._box("crosswalk-h-" + x + "-" + z + "-" + i, x + i * 0.45, 0.06, z, 0.25, 0.012, 2.6, "crosswalk", "#f8f5ec");
      }
    }
  },

  _buildHouseFrontYard: function () {
    var gy = this.data.groundY;
    this._box("front-path", 2.1, gy + 0.015, 7.0, 1.85, 0.035, 3.1, "path", "#e8d7b7");
    this._box("front-path-lip", 2.1, gy + 0.055, 8.55, 2.15, 0.08, 0.16, "curb", "#fbf8ec");
    this._box("yard-left-flowerbed", -4.8, gy + 0.02, 7.25, 4.4, 0.05, 1.0, "flowerbed", "#9be083");
    this._box("yard-right-flowerbed", 8.7, gy + 0.02, 7.25, 4.4, 0.05, 1.0, "flowerbed", "#9be083");
    this._fenceLine("front-fence-left", -7.2, 8.1, 1.0, 8.1);
    this._fenceLine("front-fence-right", 3.2, 8.1, 11.2, 8.1);
    this._fenceLine("left-yard-fence", -7.2, 6.1, -7.2, 8.1);
    this._fenceLine("right-yard-fence", 11.2, 6.1, 11.2, 8.1);

    this._box("mailbox-post", -1.0, gy + 0.05, 8.3, 0.12, 0.75, 0.12, "wood", "#b47b48");
    this._box("mailbox", -1.0, gy + 0.75, 8.3, 0.55, 0.34, 0.38, "mailbox", "#e85f71");
  },

  _fenceLine: function (name, x1, z1, x2, z2) {
    var gy = this.data.groundY;
    var dx = x2 - x1;
    var dz = z2 - z1;
    var len = Math.sqrt(dx * dx + dz * dz);
    var horizontal = Math.abs(dx) >= Math.abs(dz);
    var cx = (x1 + x2) * 0.5;
    var cz = (z1 + z2) * 0.5;
    if (horizontal) {
      this._box(name + "-rail-a", cx, gy + 0.42, cz, len, 0.08, 0.09, "fence", "#fff6df");
      this._box(name + "-rail-b", cx, gy + 0.72, cz, len, 0.08, 0.09, "fence", "#fff6df");
      for (var x = Math.min(x1, x2); x <= Math.max(x1, x2) + 0.01; x += 1.6) {
        this._box(name + "-post-" + x, x, gy + 0.07, z1, 0.12, 0.82, 0.12, "fence", "#fff6df");
      }
    } else {
      this._box(name + "-rail-a", cx, gy + 0.42, cz, 0.09, 0.08, len, "fence", "#fff6df");
      this._box(name + "-rail-b", cx, gy + 0.72, cz, 0.09, 0.08, len, "fence", "#fff6df");
      for (var z = Math.min(z1, z2); z <= Math.max(z1, z2) + 0.01; z += 1.4) {
        this._box(name + "-post-" + z, x1, gy + 0.07, z, 0.12, 0.82, 0.12, "fence", "#fff6df");
      }
    }
  },

  _buildShops: function () {
    this._shop({
      name: "candy-shop", x: -28.0, z: 22.4, w: 6.2, d: 5.0, h: 3.0,
      body: "#ffd5df", roof: "#e95f70", trim: "#fff3d0", sign: "candy"
    });
    this._shop({
      name: "bakery-shop", x: -5.2, z: 22.7, w: 7.0, d: 5.2, h: 3.25,
      body: "#e58f86", roof: "#8fd9df", trim: "#fff0c7", sign: "donut"
    });
    this._shop({
      name: "cafe-shop", x: 8.2, z: 22.6, w: 7.4, d: 5.0, h: 3.05,
      body: "#fff6d9", roof: "#59bfd0", trim: "#f1d46f", sign: "cafe", flat: true
    });
    this._shop({
      name: "corner-shop", x: 29.0, z: 22.5, w: 6.5, d: 5.1, h: 3.35,
      body: "#b7dcff", roof: "#da5e86", trim: "#fff7df", sign: "clock"
    });

    this._cafePatio(8.2, 17.9);
  },

  _shop: function (o) {
    var gy = this.data.groundY;
    var y0 = gy + 0.08;
    var front = o.z - o.d * 0.5;

    this._box(o.name + "-base", o.x, y0 - 0.08, o.z, o.w + 0.35, 0.08, o.d + 0.35, "shop-base", "#efe5d0");
    this._box(o.name + "-body", o.x, y0, o.z, o.w, o.h, o.d, o.name + "-body-mat", o.body);
    this._box(o.name + "-trim", o.x, y0 + o.h - 0.15, front - 0.085, o.w + 0.18, 0.22, 0.16, o.name + "-trim-mat", o.trim);

    if (o.flat) {
      this._box(o.name + "-roof-slab", o.x, y0 + o.h, o.z, o.w + 0.5, 0.25, o.d + 0.5, o.name + "-roof-mat", o.roof);
      this._box(o.name + "-roof-rail", o.x, y0 + o.h + 0.25, o.z - 1.9, o.w - 0.6, 0.35, 0.16, o.name + "-roof-rail-mat", "#fff3d0");
    } else {
      this._box(o.name + "-eave", o.x, y0 + o.h, o.z, o.w + 0.5, 0.18, o.d + 0.5, o.name + "-eave-mat", o.trim);
      this._gableRoof(o.name + "-gable-roof", o.x, y0 + o.h + 0.18, o.z, o.w + 0.75, 1.15, o.d + 0.65, o.name + "-roof-mat", o.roof);
    }

    this._box(o.name + "-door", o.x, y0, front - 0.05, 1.0, 1.45, 0.1, "door", "#7a5640");
    this._box(o.name + "-door-glass", o.x, y0 + 0.75, front - 0.11, 0.48, 0.46, 0.08, "window-glass", "#a8e6f7");
    this._window(o.name + "-window-l", o.x - o.w * 0.27, y0 + 1.2, front);
    this._window(o.name + "-window-r", o.x + o.w * 0.27, y0 + 1.2, front);
    this._awning(o.name + "-awning", o.x, y0 + 1.95, front, 3.2, o.sign === "candy" ? "#eb5b69" : "#d4525c", "#fff8ec");

    if (o.sign === "candy") this._candySign(o.x - o.w * 0.32, y0 + o.h + 0.6, front - 0.25);
    if (o.sign === "donut") this._donutSign(o.x, y0 + o.h + 0.65, front - 0.25);
    if (o.sign === "cafe") this._cupSign(o.x + o.w * 0.28, y0 + o.h + 0.58, front - 0.2);
    if (o.sign === "clock") this._clockSign(o.x, y0 + o.h + 0.55, front - 0.25);
  },

  _window: function (name, x, y, z) {
    this._box(name + "-frame", x, y, z - 0.045, 1.0, 0.92, 0.08, "window-frame", "#fff8ec");
    this._box(name + "-glass", x, y + 0.02, z - 0.09, 0.72, 0.64, 0.08, "window-glass", "#9fdff1");
    this._box(name + "-sill", x, y - 0.52, z - 0.09, 1.15, 0.12, 0.16, "window-sill", "#fff2cc");
  },

  _awning: function (name, x, y, z, width, colorA, colorB) {
    var stripes = 6;
    var sw = width / stripes;
    for (var i = 0; i < stripes; i++) {
      this._box(
        name + "-stripe-" + i,
        x - width * 0.5 + sw * (i + 0.5),
        y,
        z - 0.28,
        sw,
        0.18,
        0.62,
        name + "-mat-" + (i % 2),
        i % 2 ? colorB : colorA
      );
    }
  },

  _candySign: function (x, y, z) {
    this._cylinder("candy-sign-stick", x, y - 0.9, z, 0.04, 0.04, 1.25, "white", "#fff8ec", 8);
    this._sphere("candy-sign-ball", x, y, z, 0.48, "candy-red", "#ef5c7b");
    this._torus("candy-sign-ring", x, y, z - 0.02, 0.42, 0.035, "white", "#fff8ec");
  },

  _donutSign: function (x, y, z) {
    this._torus("donut-sign-dough", x, y, z, 0.55, 0.18, "donut", "#e8b06c");
    this._torus("donut-sign-icing", x, y, z - 0.015, 0.55, 0.075, "icing", "#fff1f7");
    this._sphere("donut-sprinkle-a", x - 0.22, y + 0.23, z - 0.08, 0.045, "sprinkle-red", "#e85f71");
    this._sphere("donut-sprinkle-b", x + 0.25, y - 0.08, z - 0.08, 0.045, "sprinkle-blue", "#66cde2");
    this._sphere("donut-sprinkle-c", x + 0.05, y + 0.34, z - 0.08, 0.04, "sprinkle-yellow", "#f9d35d");
  },

  _cupSign: function (x, y, z) {
    this._cylinder("cup-sign-body", x, y - 0.1, z, 0.32, 0.24, 0.45, "cup", "#fff8ec", 16);
    this._torus("cup-sign-handle", x + 0.35, y + 0.02, z, 0.18, 0.035, "cup", "#fff8ec");
    this._sphere("cup-sign-coffee", x, y + 0.16, z, 0.22, "coffee", "#8b5e45", 1, 0.18, 1);
  },

  _clockSign: function (x, y, z) {
    this._cylinder("clock-face", x, y, z, 0.55, 0.55, 0.08, "clock-face", "#fff8ec", 24).rotation.x = Math.PI / 2;
    this._torus("clock-rim", x, y, z - 0.05, 0.55, 0.045, "clock-rim", "#59bfd0");
    this._box("clock-hand-a", x, y - 0.01, z - 0.1, 0.06, 0.36, 0.04, "clock-hand", "#5f5550", -0.4);
    this._box("clock-hand-b", x + 0.11, y + 0.08, z - 0.1, 0.05, 0.3, 0.04, "clock-hand", "#5f5550", 0.75);
  },

  _cafePatio: function (x, z) {
    this._tableSet("cafe-table-a", x - 2.1, z);
    this._tableSet("cafe-table-b", x + 2.0, z);
    this._box("cafe-planter", x, 0.08, z + 1.15, 5.2, 0.45, 0.42, "planter", "#c7865a");
    for (var i = 0; i < 7; i++) {
      this._sphere("cafe-planter-flower-" + i, x - 2.1 + i * 0.7, 0.62, z + 1.05, 0.12, "flower-pink", i % 2 ? "#f9d35d" : "#f49ac1");
    }
  },

  _tableSet: function (name, x, z) {
    this._cylinder(name + "-table", x, 0.08, z, 0.48, 0.48, 0.12, "tabletop", "#d49c68", 16);
    this._cylinder(name + "-pole", x, 0.2, z, 0.045, 0.045, 1.4, "white", "#fff8ec", 8);
    this._cone(name + "-umbrella", x, 1.45, z, 1.0, 0.55, "umbrella", "#ffe58b", 24);
    this._box(name + "-chair-a", x - 0.88, 0.08, z, 0.45, 0.42, 0.45, "chair", "#fff8ec");
    this._box(name + "-chair-b", x + 0.88, 0.08, z, 0.45, 0.42, 0.45, "chair", "#fff8ec");
  },

  _buildCanalAndBridge: function () {
    this._box("canal-water", 0, -0.045, 32.4, 76, 0.04, 5.2, "water", "#64cce8", 0);
    this.mats.water.transparent = true;
    this.mats.water.opacity = 0.78;
    this.mats.water.needsUpdate = true;
    this._box("canal-bank-near", 0, 0.02, 29.65, 76, 0.12, 0.34, "bank", "#a37155");
    this._box("canal-bank-far", 0, 0.02, 35.15, 76, 0.12, 0.34, "bank", "#a37155");

    this._box("bridge-deck", 18.0, 0.12, 32.4, 7.2, 0.24, 6.7, "bridge", "#bd8052");
    this._box("bridge-rail-left", 14.65, 0.48, 32.4, 0.16, 0.28, 6.4, "bridge-rail", "#fff6df");
    this._box("bridge-rail-right", 21.35, 0.48, 32.4, 0.16, 0.28, 6.4, "bridge-rail", "#fff6df");
    for (var z = 29.6; z <= 35.2; z += 1.35) {
      this._box("bridge-post-left-" + z, 14.65, 0.18, z, 0.22, 0.75, 0.22, "bridge-rail", "#fff6df");
      this._box("bridge-post-right-" + z, 21.35, 0.18, z, 0.22, 0.75, 0.22, "bridge-rail", "#fff6df");
    }

    this._boat(31.0, 33.2);
    this._box("small-dock", 29.6, 0.08, 35.85, 4.2, 0.18, 1.2, "bridge", "#bd8052");
    this._box("dock-post-a", 27.8, 0.1, 35.25, 0.18, 0.85, 0.18, "wood", "#b47b48");
    this._box("dock-post-b", 31.4, 0.1, 35.25, 0.18, 0.85, 0.18, "wood", "#b47b48");
  },

  _boat: function (x, z) {
    this._box("boat-body", x, 0.07, z, 2.8, 0.32, 0.82, "boat", "#f4f1e3");
    this._box("boat-cabin", x - 0.3, 0.38, z, 1.0, 0.45, 0.55, "boat-cabin", "#da5e86");
    this._box("boat-nose", x + 1.45, 0.15, z, 0.35, 0.22, 0.56, "boat", "#f4f1e3", Math.PI / 4);
  },

  _buildStreetFurniture: function () {
    var lamps = [
      [-35, 8.55], [-23, 8.55], [-9, 8.55], [13, 8.55], [25, 8.55], [36, 8.55],
      [-31, 16.45], [-13, 16.45], [2, 16.45], [20, 16.45], [34, 16.45],
      [14.7, 25.0], [21.25, 25.0]
    ];
    for (var i = 0; i < lamps.length; i++) this._lamp("lamp-" + i, lamps[i][0], lamps[i][1]);

    this._bench("bench-a", -33, 17.25);
    this._bench("bench-b", 33, 17.25);
    this._bench("bench-c", -9.2, 7.95);
    this._trashCan(-21.2, 16.9);
    this._trashCan(12.9, 8.1);
  },

  _lamp: function (name, x, z) {
    this._cylinder(name + "-base", x, 0.06, z, 0.18, 0.22, 0.12, "lamp-dark", "#303843", 10);
    this._cylinder(name + "-pole", x, 0.16, z, 0.055, 0.065, 1.95, "lamp-dark", "#303843", 8);
    this._sphere(name + "-globe", x, 2.22, z, 0.28, "lamp-glow", "#fff5cf", 1, 1, 1, {
      emissive: "#fff0a8",
      emissiveIntensity: 0.55
    });
  },

  _bench: function (name, x, z) {
    this._box(name + "-seat", x, 0.34, z, 1.65, 0.18, 0.42, "bench", "#b47b48");
    this._box(name + "-back", x, 0.72, z + 0.22, 1.65, 0.22, 0.12, "bench", "#b47b48");
    this._box(name + "-leg-a", x - 0.55, 0.08, z, 0.12, 0.34, 0.12, "lamp-dark", "#303843");
    this._box(name + "-leg-b", x + 0.55, 0.08, z, 0.12, 0.34, 0.12, "lamp-dark", "#303843");
  },

  _trashCan: function (x, z) {
    this._cylinder("trash-can-" + x, x, 0.08, z, 0.28, 0.24, 0.62, "trash", "#76b6a0", 12);
    this._cylinder("trash-lid-" + x, x, 0.7, z, 0.3, 0.3, 0.08, "trash-dark", "#4f927d", 12);
  },

  _buildPlanting: function () {
    var trees = [
      [-34, 6.4, "round"], [-25, 18.8, "cone"], [-12, 18.5, "striped"],
      [15, 18.5, "round"], [35, 18.9, "cone"], [-34, 24.5, "cone"],
      [36, 25.0, "round"], [-5.5, 7.15, "round"], [9.7, 7.1, "striped"],
      [-18.6, 4.9, "cone"], [20.8, 4.9, "cone"], [-31, -5.8, "round"],
      [24.5, -5.8, "round"], [-4, -8.5, "cone"], [15, -8.2, "cone"],
      [-25, 39.0, "cone"], [4, 38.4, "round"], [34, 39.0, "striped"]
    ];
    for (var i = 0; i < trees.length; i++) {
      this._tree("tree-" + i, trees[i][0], trees[i][1], trees[i][2]);
    }

    for (var j = 0; j < 20; j++) {
      var side = j % 2 ? -1 : 1;
      var x = side > 0 ? 5.2 + (j % 5) * 1.05 : -6.2 + (j % 5) * 1.05;
      var z = 6.6 + Math.floor(j / 5) * 0.42;
      this._sphere("yard-flower-" + j, x, 0.18, z, 0.08, j % 3 ? "flower-pink" : "flower-blue", j % 3 ? "#f49ac1" : "#84c8ff");
    }
  },

  _tree: function (name, x, z, type) {
    this._cylinder(name + "-trunk", x, 0.06, z, 0.18, 0.22, 0.9, "tree-trunk", "#b47b48", 9);
    if (type === "cone") {
      this._cone(name + "-leaf-a", x, 0.74, z, 0.92, 1.3, "leaf-dark", "#4eb36f", 10);
      this._cone(name + "-leaf-b", x, 1.45, z, 0.72, 1.05, "leaf", "#6fd57a", 10);
      this._cone(name + "-leaf-c", x, 2.05, z, 0.5, 0.85, "leaf-light", "#8fe58a", 10);
    } else if (type === "striped") {
      this._sphere(name + "-leaf", x, 1.65, z, 0.86, "leaf", "#70cf7a", 1, 1.35, 1);
      this._torus(name + "-stripe-a", x, 1.38, z, 0.62, 0.055, "stripe-white", "#fff8ec", Math.PI / 2);
      this._torus(name + "-stripe-b", x, 1.78, z, 0.62, 0.055, "stripe-white", "#fff8ec", Math.PI / 2);
    } else {
      this._sphere(name + "-leaf-a", x, 1.38, z, 0.82, "leaf", "#69cf75");
      this._sphere(name + "-leaf-b", x - 0.42, 1.22, z + 0.05, 0.46, "leaf-light", "#8fe58a");
      this._sphere(name + "-leaf-c", x + 0.44, 1.2, z - 0.05, 0.46, "leaf-dark", "#4eb36f");
    }
  },

  _buildSkyDetails: function () {
    this._sphere("sun", -32, 10.5, -18, 1.4, "sun", "#ffe58b", 1, 1, 1, {
      emissive: "#ffde6b",
      emissiveIntensity: 0.45
    });
    this._cloud("cloud-a", -22, 8.5, 2.5);
    this._cloud("cloud-b", 18, 10.0, -11.5);
    this._cloud("cloud-c", 33, 7.8, 7.0);
    this._hotAirBalloon(31, 8.5, 12.5);
    this._balloonCluster(-34, 17.4);
  },

  _cloud: function (name, x, y, z) {
    this._sphere(name + "-a", x, y, z, 0.8, "cloud", "#ffffff", 1.4, 0.65, 0.75);
    this._sphere(name + "-b", x + 0.8, y + 0.18, z + 0.05, 0.65, "cloud", "#ffffff", 1.2, 0.7, 0.75);
    this._sphere(name + "-c", x - 0.75, y + 0.08, z - 0.02, 0.58, "cloud", "#ffffff", 1.2, 0.75, 0.75);
  },

  _hotAirBalloon: function (x, y, z) {
    this._sphere("hotair-balloon", x, y + 1.5, z, 1.25, "balloon-blue", "#9adbe8", 1.0, 1.25, 1.0);
    this._torus("hotair-band-a", x, y + 1.95, z, 0.95, 0.05, "stripe-white", "#fff8ec", Math.PI / 2);
    this._torus("hotair-band-b", x, y + 1.15, z, 0.82, 0.05, "stripe-white", "#fff8ec", Math.PI / 2);
    this._box("hotair-basket", x, y - 0.1, z, 0.95, 0.6, 0.72, "basket", "#a66e45");
    this._box("hotair-rope-a", x - 0.43, y + 0.47, z - 0.28, 0.035, 1.05, 0.035, "rope", "#fff8ec");
    this._box("hotair-rope-b", x + 0.43, y + 0.47, z - 0.28, 0.035, 1.05, 0.035, "rope", "#fff8ec");
    this._box("hotair-rope-c", x - 0.43, y + 0.47, z + 0.28, 0.035, 1.05, 0.035, "rope", "#fff8ec");
    this._box("hotair-rope-d", x + 0.43, y + 0.47, z + 0.28, 0.035, 1.05, 0.035, "rope", "#fff8ec");
  },

  _balloonCluster: function (x, z) {
    var colors = ["#f49ac1", "#ffe58b", "#77d7ff", "#8ee67a"];
    for (var i = 0; i < 4; i++) {
      var bx = x + i * 0.42;
      var by = 2.5 + (i % 2) * 0.35;
      this._sphere("balloon-" + i, bx, by, z + i * 0.1, 0.28, "balloon-" + i, colors[i], 0.95, 1.2, 0.95);
      this._box("balloon-string-" + i, bx, 0.9, z + i * 0.1, 0.025, by - 1.0, 0.025, "rope", "#fff8ec");
    }
  }
});