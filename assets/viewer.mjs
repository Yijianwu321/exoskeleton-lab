import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { DRACOLoader } from './vendor/DRACOLoader.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

const root = document.querySelector('.exo-viewer');
const $ = (s) => root.querySelector(s);
const stage = $('.exo-stage');
const canvas = $('.exo-canvas');
const loading = $('.exo-loading');
const status = $('[data-status]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const controlsElements = root.querySelectorAll('button,input');
controlsElements.forEach((el) => el.disabled = true);
let renderer, scene, camera, controls, model, selected, environment, mergedModel;
let meshes = [], spread = 0, targetSpread = 0, active = true, auto = false, ready = false;
let viewTween = null, lastTime = 0, pending = false, pointerStart = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const accent = new THREE.Color('#0a705b');
const initialView = new THREE.Vector3(2.7, 1.2, 4.4);
const diagnostics = { ready:false, modelSource:'shoulder-assembly.glb', meshes:0, triangles:0, selected:null, spread:0, mode:'solid', error:null };
window.exoDiagnostics = diagnostics;

function fail(error) {
  diagnostics.error = String(error?.message || error);
  status.textContent = '暂时无法显示';
  loading.hidden = false;
  loading.querySelector('.exo-loading-bar')?.remove();
  loading.querySelector('[data-loading-text]').textContent = location.protocol === 'file:'
    ? '请运行同目录的“启动预览.cmd”，通过本地预览打开三维模型。'
    : '三维模型加载失败。请刷新重试，或检查浏览器是否支持 WebGL。';
  console.error('EXO viewer:', error);
}

function requestFrame() {
  if (!pending && ready && active && !document.hidden) {
    pending = true;
    requestAnimationFrame(render);
  }
}

function resize() {
  if (!renderer) return;
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  requestFrame();
}

function setAuto(value) {
  auto = value;
  controls.autoRotate = value;
  $('[data-auto]').setAttribute('aria-pressed', String(value));
  $('[data-auto] span').textContent = value ? '暂停旋转' : '自动旋转';
  requestFrame();
}

function clearSelection() {
  if (selected) selected.material.emissive.copy(selected.userData.emissive);
  selected = null;
  diagnostics.selected = null;
  $('[data-selection]').innerHTML = '<strong>点击模型中的任意零件</strong>查看导入文件中的零件名称。';
}

function setView(name, instant = false) {
  const directions = { perspective:initialView, front:new THREE.Vector3(0,.2,5.2), side:new THREE.Vector3(5.2,.2,0), back:new THREE.Vector3(0,.2,-5.2) };
  const dest = directions[name].clone();
  dest.multiplyScalar(1+targetSpread*.7);
  if (camera.aspect < .85) dest.multiplyScalar(1.16);
  setAuto(false);
  // Consume any remaining drag inertia before a preset camera move.
  const damping=controls.enableDamping;
  controls.enableDamping=false;
  controls.update();
  controls.enableDamping=damping;
  if (instant || reducedMotion.matches) {
    camera.position.copy(dest);
    controls.target.set(0,0,0);
    controls.update();
  } else viewTween = { start:camera.position.clone(), dest, target:controls.target.clone(), time:performance.now() };
  root.querySelectorAll('[data-view]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.view === name)));
  requestFrame();
}

function render(time) {
  pending = false;
  if (!ready || !active || document.hidden) return;
  const delta = Math.min((time - (lastTime || time)) / 1000, .25);
  lastTime = time;
  let animate = false;
  spread = targetSpread;
  for (const mesh of meshes) {
    mesh.position.copy(mesh.userData.base).addScaledVector(mesh.userData.displacement, spread);
    mesh.visible = spread > 0 || mesh === selected;
  }
  mergedModel.visible = spread === 0;
  diagnostics.spread = spread;
  if (viewTween) {
    const t = Math.min((time-viewTween.time)/650,1), eased = 1-Math.pow(1-t,4);
    camera.position.lerpVectors(viewTween.start,viewTween.dest,eased);
    controls.target.copy(viewTween.target).multiplyScalar(1-eased);
    if (t >= 1) viewTween = null;
    animate = true;
  }
  controls.update(delta);
  renderer.render(scene,camera);
  diagnostics.camera = camera.position.toArray();
  diagnostics.frames=(diagnostics.frames||0)+1;
  if (auto || animate) requestFrame();
}

async function init() {
  renderer = new THREE.WebGLRenderer({ canvas, alpha:true, antialias:true, powerPreference:'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0xf4f8fb,0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35,1,.01,100);
  camera.position.copy(initialView);
  controls = new OrbitControls(camera,canvas);
  controls.enableDamping = !reducedMotion.matches;
  controls.dampingFactor = .09;
  controls.enablePan = false;
  controls.minDistance = 1.9;
  controls.maxDistance = 11;
  controls.autoRotateSpeed = .45;
  controls.maxPolarAngle = Math.PI * .93;
  controls.addEventListener('change',requestFrame);
  controls.addEventListener('start',() => {viewTween=null;setAuto(false);root.querySelectorAll('[data-view]').forEach(el=>el.setAttribute('aria-pressed','false'));});
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  environment = pmrem.fromScene(room,.04);
  scene.environment = environment.texture;
  room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe7f5ff,0x607876,.8));
  const key = new THREE.DirectionalLight(0xffffff,2.4);key.position.set(3,6,5);scene.add(key);
  const rim = new THREE.DirectionalLight(0xc9f3e5,1.5);rim.position.set(-3,2,-3);scene.add(rim);

  // All geometry and decoders are hosted beside the site. No remote assets.
  const draco = new DRACOLoader();
  draco.setDecoderPath(new URL('./vendor/', import.meta.url).href);
  draco.setWorkerLimit(2);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const gltf = await loader.loadAsync(new URL('./models/shoulder-assembly.glb',import.meta.url).href);
  gltf.scene.updateMatrixWorld(true);
  const sourceBox = new THREE.Box3().setFromObject(gltf.scene);
  const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
  const size = sourceBox.getSize(new THREE.Vector3());
  const scale = 2.5 / Math.max(size.x,size.y,size.z);
  diagnostics.originalBounds = size.toArray();
  model = new THREE.Group();
  // This static CAD file has no animation or skeleton. Flattening world transforms
  // preserves its assembly while allowing a reversible visual exploded view.
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    const geometry = node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);
    geometry.translate(-sourceCenter.x,-sourceCenter.y,-sourceCenter.z);
    geometry.scale(scale,scale,scale);
    geometry.computeBoundingBox();
    for(const name of Object.keys(geometry.attributes))if(!['position','normal'].includes(name))geometry.deleteAttribute(name);
    if(!geometry.attributes.normal)geometry.computeVertexNormals();
    const originalColor=node.material.color.clone();
    const luminosity=(originalColor.r+originalColor.g+originalColor.b)/3;
    const finishColor=originalColor.clone();
    // The pale CAD palette receives a slate-aluminium display finish. Original
    // part positions and geometry stay intact; this is not a material claim.
    if(luminosity>.62)finishColor.set('#a9bcc6');
    else if(luminosity>.3)finishColor.set('#597780');
    else finishColor.multiplyScalar(.85);
    if(/肩関節連結|アルミカップリング/.test(node.name))finishColor.set('#247c6b');
    const mat=new THREE.MeshStandardMaterial({color:finishColor,metalness:.65,roughness:.38,envMapIntensity:.9,side:node.material.side,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
    const mesh = new THREE.Mesh(geometry,mat);
    mesh.name = node.name;
    const center = geometry.boundingBox.getCenter(new THREE.Vector3());
    mesh.userData.base = mesh.position.clone();
    mesh.userData.displacement = center.clone().multiplyScalar(.85);
    mesh.userData.emissive = mat.emissive.clone();
    mesh.userData.originalColor = mat.color.clone();
    model.add(mesh);meshes.push(mesh);
    diagnostics.triangles += (geometry.index?.count || geometry.attributes.position.count) / 3;
  });
  scene.add(model);
  // Solid assemblies share a handful of finishes. Batch their geometry for
  // fewer draw calls; retain the individual meshes for selection and spreading.
  mergedModel=new THREE.Group();
  const buckets=new Map();
  for(const mesh of meshes){const key=mesh.material.color.getHexString()+'-'+mesh.material.side;const bucket=buckets.get(key)||[];bucket.push(mesh);buckets.set(key,bucket);}
  for(const bucket of buckets.values()){
    const allIndexed=bucket.every(mesh=>!!mesh.geometry.index);
    const geometries=bucket.map(mesh=>allIndexed?mesh.geometry:mesh.geometry.toNonIndexed());
    const geometry=mergeGeometries(geometries,false);
    if(!geometry)throw new Error('Cannot batch model geometry');
    const material=bucket[0].material.clone();material.polygonOffset=false;
    const combined=new THREE.Mesh(geometry,material);combined.userData.originalColor=material.color.clone();mergedModel.add(combined);
  }
  scene.add(mergedModel);
  diagnostics.solidDrawCalls=mergedModel.children.length;
  diagnostics.meshes = meshes.length;
  draco.dispose();

  // A generated, local contact shadow anchors the imported assembly.
  const shadowCanvas = document.createElement('canvas');shadowCanvas.width=128;shadowCanvas.height=128;
  const ctx=shadowCanvas.getContext('2d');
  const grad=ctx.createRadialGradient(64,64,1,64,64,63);grad.addColorStop(0,'rgba(23,52,71,.22)');grad.addColorStop(1,'rgba(23,52,71,0)');ctx.fillStyle=grad;ctx.fillRect(0,0,128,128);
  const floorY = new THREE.Box3().setFromObject(model).min.y - .09;
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.8,2.3),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false}));
  shadow.rotation.x = -Math.PI/2;shadow.position.y=floorY;scene.add(shadow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.45,1.455,96),new THREE.MeshBasicMaterial({color:0x87b1aa,transparent:true,opacity:.55,side:THREE.DoubleSide}));
  ring.rotation.x=-Math.PI/2;ring.position.y=floorY-.01;scene.add(ring);

  ready=true;diagnostics.ready=true;
  controlsElements.forEach(el=>el.disabled=false);
  loading.hidden=true;status.textContent='可交互';
  resize();setView('perspective',true);
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(entries=>{active=entries[0].isIntersecting;if(active){lastTime=0;requestFrame();}},{rootMargin:'100px'}).observe(stage);
  document.addEventListener('visibilitychange',()=>{lastTime=0;requestFrame();});
  reducedMotion.addEventListener('change',()=>{controls.enableDamping=!reducedMotion.matches;if(reducedMotion.matches){setAuto(false);viewTween=null;}requestFrame();});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();ready=false;fail(new Error('WebGL context lost'));});
  canvas.addEventListener('webglcontextrestored',()=>location.reload());

  root.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>setView(el.dataset.view)));
  root.querySelectorAll('[data-mode]').forEach(el=>el.addEventListener('click',()=>{
    const mode=el.dataset.mode;diagnostics.mode=mode;
    meshes.forEach(mesh=>{mesh.material.wireframe=mode==='wire';mesh.material.color.copy(mode==='wire'?accent:mesh.userData.originalColor);});
    mergedModel.children.forEach(mesh=>{mesh.material.wireframe=mode==='wire';mesh.material.color.copy(mode==='wire'?accent:mesh.userData.originalColor);});
    root.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button===el)));
    requestFrame();
  }));
  $('[data-explode]').addEventListener('input',event=>{const previous=targetSpread;targetSpread=Number(event.target.value)/100;camera.position.multiplyScalar((1+targetSpread*.7)/(1+previous*.7));viewTween=null;setAuto(false);$('[data-spread]').textContent=event.target.value+'%';requestFrame();});
  $('[data-auto]').addEventListener('click',()=>setAuto(!auto));
  $('[data-reset]').addEventListener('click',()=>{clearSelection();targetSpread=0;$('[data-explode]').value=0;$('[data-spread]').textContent='0%';setView('perspective');});
  $('[data-zoom-in]').addEventListener('click',()=>{viewTween=null;camera.position.multiplyScalar(.85);if(camera.position.length()<controls.minDistance)camera.position.setLength(controls.minDistance);controls.update();requestFrame();});
  $('[data-zoom-out]').addEventListener('click',()=>{viewTween=null;camera.position.multiplyScalar(1.15);if(camera.position.length()>controls.maxDistance)camera.position.setLength(controls.maxDistance);controls.update();requestFrame();});
  const full=$('[data-fullscreen]');
  if(!document.fullscreenEnabled)full.hidden=true;
  full.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await root.requestFullscreen();}catch(e){status.textContent='浏览器未允许全屏';}});
  document.addEventListener('fullscreenchange',()=>{full.setAttribute('aria-label',document.fullscreenElement?'退出全屏':'全屏查看');full.setAttribute('aria-pressed',String(!!document.fullscreenElement));resize();});
  canvas.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-','=','Home','Escape'].includes(event.key))return;
    event.preventDefault();viewTween=null;setAuto(false);
    const spherical=new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    if(event.key==='ArrowLeft')spherical.theta-=.12;
    if(event.key==='ArrowRight')spherical.theta+=.12;
    if(event.key==='ArrowUp')spherical.phi-=.1;
    if(event.key==='ArrowDown')spherical.phi+=.1;
    if(event.key==='+'||event.key==='=')spherical.radius*=.9;
    if(event.key==='-')spherical.radius*=1.1;
    spherical.radius=THREE.MathUtils.clamp(spherical.radius,controls.minDistance,controls.maxDistance);spherical.makeSafe();
    camera.position.setFromSpherical(spherical).add(controls.target);controls.update();
    if(event.key==='Home')setView('perspective');
    if(event.key==='Escape')clearSelection();
    requestFrame();
  });
  canvas.addEventListener('pointerdown',event=>{pointerStart={x:event.clientX,y:event.clientY};});
  canvas.addEventListener('pointerup',event=>{
    if(!pointerStart||Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>5)return;
    const rect=canvas.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects(meshes,false)[0];clearSelection();
    if(hit){selected=hit.object;selected.material.emissive.set('#176c5a');diagnostics.selected=selected.name;const strong=document.createElement('strong');strong.textContent=selected.name;const detail=document.createTextNode('已选中 · 名称来自原始装配文件');$('[data-selection]').replaceChildren(strong,detail);}
    requestFrame();
  });
  requestFrame();
}

init().catch(fail);
