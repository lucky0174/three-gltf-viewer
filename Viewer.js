/* global dat */

const THREE = window.THREE = require('three');
const Stats = require('./lib/stats.min.js');
const environments = require('./assets/environment/index');
const createVignetteBackground = require('three-vignette-background');

require('./lib/GLTF2Loader');
require('./lib/OrbitControls');

module.exports = class Viewer {

  constructor (el) {
    this.el = el;

    this.lights = [];
    this.content = null;
    this.mixer = null;
    this.clips = [];
    this.gui = null;

    this.state = {
      environment: environments[1].name,
      background: false,
      playAnimation: true,
      autoRotate: false,
      addLights: true,
      directColor: 0xffeedd,
      directIntensity: 1,
      ambientColor: 0x222222,
      ambientIntensity: 1
    };

    this.prevTime = 0;

    this.stats = new Stats();

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera( 60, el.clientWidth / el.clientHeight, 0.01, 1000 );

    this.renderer = new THREE.WebGLRenderer({antialias: true});
    this.renderer.setClearColor( 0xcccccc );
    this.renderer.setPixelRatio( window.devicePixelRatio );
    this.renderer.setSize( el.clientWidth, el.clientHeight );

    this.controls = new THREE.OrbitControls( this.camera, this.renderer.domElement );
    this.controls.autoRotate = this.state.autoRotate;
    this.controls.autoRotateSpeed = -10;

    this.background = createVignetteBackground({
      aspect: this.camera.aspect,
      grainScale: 0.001,
      colors: ['#ffffff', '#353535']
    });

    this.el.appendChild(this.renderer.domElement);

    this.envMapCtrl = null;
    this.animationCtrl = null;
    this.autoRotateCtrl = null;
    this.lightCtrl = null;
    this.morphFolder = null;
    this.morphCtrls = [];

    this.addGUI();

    this.animate = this.animate.bind(this);
    requestAnimationFrame( this.animate );
    window.addEventListener('resize', this.resize.bind(this), false);
  }

  animate (time) {

    requestAnimationFrame( this.animate );

    const dt = (time - this.prevTime) / 1000;

    this.controls.update();
    this.stats.update();
    this.mixer && this.mixer.update(dt);
    this.render();

    this.prevTime = time;

  }

  render () {

    this.renderer.render( this.scene, this.camera );

  }

  resize () {

    this.camera.aspect = this.el.clientWidth / this.el.clientHeight;
    this.camera.updateProjectionMatrix();


    this.background.style({aspect: this.camera.aspect});

    this.renderer.setSize(this.el.clientWidth, this.el.clientHeight);

  }

  load ( url, rootPath, assetMap ) {

    return new Promise((resolve, reject) => {

      const loader = new THREE.GLTF2Loader();
      loader.setCrossOrigin('anonymous');
      const blobURLs = [];

      // Hack to intercept relative URLs.
      window.gltfPathTransform = (url, path) => {

        const normalizedURL = rootPath + url.replace(/^(\.?\/)/, '');
        if (assetMap.has(normalizedURL)) {
          const blob = assetMap.get(normalizedURL);
          const blobURL = URL.createObjectURL(blob);
          blobURLs.push(blobURL);
          return blobURL;
        }

        return (path || '') + url;

      };

      loader.load(url, (gltf) => {

        this.setContent(gltf.scene || gltf.scenes[0]);
        this.setClips( gltf.animations || [] );

        blobURLs.forEach(URL.revokeObjectURL);

        resolve();

      }, undefined, reject);

    });

  }

  setContent ( object ) {

    this.clear();

    object.updateMatrixWorld();
    var box = new THREE.Box3().setFromObject(object);
    var center = box.getCenter();

    this.controls.reset();

    object.position.x += (object.position.x - center.x);
    object.position.y += (object.position.y - center.y);
    object.position.z += (object.position.z - center.z);
    this.controls.maxDistance = box.getSize().length() * 10;
    this.camera.position.copy(center);
    this.camera.position.x += box.getSize().length() / 1.25;
    this.camera.position.y += box.getSize().length();
    this.camera.position.z += box.getSize().length() / 1.25;
    this.camera.near = box.getSize().length() / 100;
    this.camera.far = box.getSize().length() * 100;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);

    this.controls.saveState();

    this.scene.add(object);
    this.content = object;

    this.state.addLights = true;
    this.content.traverse((node) => {
      if (node.isLight) {
        this.state.addLights = false;
      }
    });

    this.updateLights();
    this.updateGUI();
    this.updateEnvironment();

  }

  setClips ( clips ) {
    this.stopAnimation();

    if (this.mixer) {
      this.mixer.uncacheRoot(this.mixer.getRoot());
      this.mixer = null;
    }

    this.clips = clips;
    if (!clips.length) return;

    this.mixer = new THREE.AnimationMixer( this.content );

    if (this.state.playAnimation) this.playAnimation();
  }

  playAnimation () {
    this.clips.forEach((clip) => this.mixer.clipAction(clip).play());
  }

  stopAnimation () {
    if (this.mixer) this.mixer.stopAllAction();
  }

  updateLights () {
    if (this.state.addLights && !this.lights.length) {
      this.addLights();
    } else if (!this.state.addLights && this.lights.length) {
      this.removeLights();
    }
  }

  addLights () {

    const light1 = new THREE.DirectionalLight( this.state.directColor );
    light1.position.set( 0, 0, 1 );
    this.scene.add(light1);

    const light2 = new THREE.DirectionalLight( this.state.directColor );
    light2.position.set( 0, 5, -5 );
    this.scene.add(light2);

    const light3 = new THREE.AmbientLight( this.state.ambientColor );
    this.scene.add( light3 );

    this.lights.push(light1, light2, light3);

  }

  removeLights () {

    this.lights.forEach((light) => this.scene.remove(light));
    this.lights.length = 0;

  }

  updateEnvironment () {

    const environment = environments.filter((entry) => entry.name === this.state.environment)[0];
    const {path, format} = environment;

    let envMap = null;
    if (path) {
        envMap = new THREE.CubeTextureLoader().load([
          path + 'posx' + format, path + 'negx' + format,
          path + 'posy' + format, path + 'negy' + format,
          path + 'posz' + format, path + 'negz' + format
        ]);
        envMap.format = THREE.RGBFormat;
    }

    if (!envMap || !this.state.background) {
      this.scene.add(this.background);
    } else {
      this.scene.remove(this.background);
    }

    this.content.traverse((node) => {
      if (node.material && 'envMap' in node.material) {
        node.material.envMap = envMap;
        node.material.needsUpdate = true;
      }
    });

    this.scene.background = this.state.background ? envMap : null;

  }

  addGUI () {

    const gui = this.gui = new dat.GUI({autoPlace: false, width: 260});

    // Animation controls.
    this.animationCtrl = gui.add(this.state, 'playAnimation');
    this.animationCtrl.onChange((playAnimation) => {
      playAnimation ? this.playAnimation() : this.stopAnimation();
    });

    // Auto-rotate controls.
    this.autoRotateCtrl = gui.add(this.state, 'autoRotate');
    this.autoRotateCtrl.onChange((autoRotate) => {
      this.controls.autoRotate = autoRotate;
    });

    // Environment map controls.
    const envFolder = gui.addFolder('Environment');
    this.envMapCtrl = envFolder.add(this.state, 'environment', environments.map((env) => env.name));
    this.envMapCtrl.onChange(() => this.updateEnvironment());
    this.envBackgroundCtrl = envFolder.add(this.state, 'background');
    this.envBackgroundCtrl.onChange(() => this.updateEnvironment());

    // Lighting controls.
    const lightFolder = gui.addFolder('Lights');
    this.lightCtrl = lightFolder.add(this.state, 'addLights');
    this.lightCtrl.onChange(() => this.updateLights());
    const directColor = lightFolder.addColor(this.state, 'directColor');
    directColor.onChange((hex) => {
      this.lights[0].color.setHex(hex);
      this.lights[1].color.setHex(hex);
    });
    const directIntensity = lightFolder.add(this.state, 'directIntensity', 0, 1);
    directIntensity.onChange((intensity) => {
      this.lights[0].intensity = intensity;
      this.lights[1].intensity = intensity;
    });
    const ambientColor = lightFolder.addColor(this.state, 'ambientColor');
    ambientColor.onChange((hex) => {
      this.lights[2].color.setHex(hex);
    });
    const ambientIntensity = lightFolder.add(this.state, 'ambientIntensity', 0, 1);
    ambientIntensity.onChange((intensity) => {
      this.lights[2].intensity = intensity;
    });

    // Stats.
    const perfFolder = gui.addFolder('Performance');
    const perfLi = document.createElement('li');
    this.stats.dom.style.position = 'static';
    perfLi.appendChild(this.stats.dom);
    perfLi.classList.add('gui-stats');
    perfFolder.__ul.appendChild( perfLi );
    perfFolder.open();

    const guiWrap = document.createElement('div');
    this.el.appendChild( guiWrap );
    guiWrap.classList.add('gui-wrap');
    guiWrap.appendChild(gui.domElement);
    gui.open();

  }

  updateGUI () {
    this.lightCtrl.updateDisplay();

    if (this.morphFolder) {
      this.morphCtrls.forEach((ctrl) => ctrl.remove());
      this.morphCtrls.length = 0;
      this.morphFolder.domElement.style.display = 'none';
    }

    const morphMeshes = [];
    this.content.traverse((node) => {
      if (node.isMesh && node.morphTargetInfluences) {
        morphMeshes.push(node);
      }
    });
    if (!morphMeshes.length) return;

    this.morphFolder = this.morphFolder || this.gui.addFolder('Morph Targets');
    this.morphFolder.domElement.style.display = '';
    morphMeshes.forEach((mesh) => {
      if (mesh.morphTargetInfluences.length) {
        const nameCtrl = this.morphFolder.add({name: mesh.name || 'Untitled'}, 'name');
        this.morphCtrls.push(nameCtrl);
      }
      for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
        const ctrl = this.morphFolder.add(mesh.morphTargetInfluences, i, 0, 1).listen();
        this.morphCtrls.push(ctrl);
      }
    });
  }

  clear () {

    this.scene.remove( this.content );

  }

};
