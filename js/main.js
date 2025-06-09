import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // Diaktifkan untuk kontrol kamera

// --- Variabel Global ---
let scene, camera, renderer, controls; // Tambahkan controls untuk OrbitControls
let table, ball, tv, fan, fanBlades;
let videoElement, videoTexture, videoTextureAppliedToScreen = false, tvScreenMaterialFound = false;

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const clock = new THREE.Clock();

// Fisika Bola
let ballVelocity = new THREE.Vector3(0, 0, 0);
const gravity = new THREE.Vector3(0, -9.8, 0); // Gravitasi (unit/detik^2)
const bounceDamping = 0.65; // Sedikit lebih memantul
let ballOnTable = false; // Akan di-set true saat bola berhasil diletakkan di meja
let floorLevel = 0;
let tableSurfaceY;
const ballRadius = 0.0375; // Radius bola baseball dari GLTF

// Interaksi Kipas
let isFanHovered = false;

// Konstanta dari GLTF
const TABLE_MODEL_HEIGHT = 0.7994177341461182;

// --- Fungsi Utama ---
function init() {
    // Scene
    scene = new THREE.Scene();

    // Camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000); //FOV sedikit dikurangi
    // Posisi kamera diubah untuk melihat dari "luar"
    camera.position.set(2.5, 2.2, 3.5); // Mundur dan sedikit ke atas
    camera.lookAt(0, 0.8, 0); // Fokus ke area tengah scene (sekitar meja)

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true; // Aktifkan shadow map
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Bayangan lebih halus
    document.getElementById('container').appendChild(renderer.domElement);

    // OrbitControls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.8, 0); // Target orbit di sekitar meja
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.5; // Jarak zoom minimal
    controls.maxDistance = 15;  // Jarak zoom maksimal
    controls.update();

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4); // Intensitas ambient disesuaikan
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0); // Intensitas directional disesuaikan
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    // Konfigurasi shadow untuk directional light
    directionalLight.shadow.mapSize.width = 2048; // Resolusi peta bayangan
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 50;
    directionalLight.shadow.camera.left = -10;
    directionalLight.shadow.camera.right = 10;
    directionalLight.shadow.camera.top = 10;
    directionalLight.shadow.camera.bottom = -10;
    scene.add(directionalLight);
    // scene.add(new THREE.CameraHelper(directionalLight.shadow.camera)); // Untuk debug bayangan

    // Loaders
    const gltfLoader = new GLTFLoader();
    const exrLoader = new EXRLoader();

    // Muat HDRI (GANTI DENGAN NAMA FILE .EXR KAMU)
    exrLoader.load('assets/hdri/small_empty_room_3_4k.exr', (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = texture;
        scene.environment = texture;
        console.log("HDRI .exr dimuat.");
    }, undefined, (error) => console.error('Gagal memuat HDRI:', error));

    // Buat Lantai Prosedural Sederhana
    const floorGeometry = new THREE.PlaneGeometry(10, 10);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.7, metalness: 0.1 });
    const proceduralFloor = new THREE.Mesh(floorGeometry, floorMaterial);
    proceduralFloor.rotation.x = -Math.PI / 2;
    proceduralFloor.position.y = 0;
    proceduralFloor.receiveShadow = true; // Lantai menerima bayangan
    scene.add(proceduralFloor);
    floorLevel = proceduralFloor.position.y;
    console.log("Lantai prosedural dibuat pada Y:", floorLevel);

    // Siapkan elemen video HTML
    videoElement = document.getElementById('tvScreenVideo');
    if (!videoElement) console.error("Elemen video HTML 'tvScreenVideo' tidak ditemukan!");
    else videoElement.muted = true;

    // Memuat model MEJA terlebih dahulu
    gltfLoader.load('assets/models/table/wooden_table_02.gltf', (gltf) => {
        table = gltf.scene;
        table.position.set(0, floorLevel, 0);
        // table.scale.set(1, 1, 1); // Sesuaikan skala jika perlu

        const tableBoundingBox = new THREE.Box3().setFromObject(table);
        tableSurfaceY = tableBoundingBox.max.y;

        table.traverse(child => { if (child.isMesh) child.castShadow = true; });
        scene.add(table);
        console.log("Meja dimuat. Permukaan atas Y:", tableSurfaceY);

        loadBallModel();
        loadTVModel();
        loadFanModel();
    }, undefined, (error) => console.error('Error loading table:', error));

    window.addEventListener('resize', onWindowResize, false);
    document.addEventListener('click', onClick, false);
    document.addEventListener('mousemove', onMouseMove, false);

    animate();
}

// --- Fungsi Pemuatan Model ---
function loadBallModel() {
    if (tableSurfaceY === undefined) { console.error("Meja belum siap untuk bola."); return; }
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('assets/models/ball/baseball_01.gltf', (gltf) => {
        ball = gltf.scene;
        // ball.scale.set(1.5, 1.5, 1.5); // Sesuaikan skala bola jika perlu

        const ballEffectiveRadius = ballRadius * (ball.scale.y || 1);
        ball.position.set(
            table.position.x + 0.1, // Sedikit di pinggir meja (sesuaikan X)
            tableSurfaceY + ballEffectiveRadius + 0.005, // +0.005 agar tidak tembus awal
            table.position.z        // Tengah meja (sesuaikan Z)
        );
        ball.traverse(child => { if (child.isMesh) {child.castShadow = true; child.receiveShadow = false;} });
        scene.add(ball);
        ballOnTable = true; // Penting: set true di sini
        console.log("Bola dimuat di atas meja Y:", ball.position.y);
    }, undefined, (error) => console.error('Error loading ball:', error));
}

function loadTVModel() {
    if (tableSurfaceY === undefined) { console.warn("Meja belum siap untuk TV."); }
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('assets/models/tv/Television_01.gltf', (gltf) => {
        tv = gltf.scene;
        tv.position.set(
            table.position.x + 0.3,
            tableSurfaceY,
            table.position.z - 0.3 // Mundur sedikit lagi
        );
        // tv.scale.set(1, 1, 1);
        // tv.rotation.y = -Math.PI / 8; // Sedikit menyerong
        tv.traverse(child => { if (child.isMesh) child.castShadow = true; });
        scene.add(tv);
        console.log("TV dimuat.");

        // !! PENTING SEKALI !! Ganti "TV_Layar_Material_Asli_Dari_Blender"
        // dengan NAMA MATERIAL yang kamu berikan untuk LAYAR TV di BLENDER setelah diedit.
        const targetMaterialName = "Television_01";
        tvScreenMaterialFound = false;
        videoTextureAppliedToScreen = false;

        tv.traverse((child) => {
            if (child.isMesh) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(material => {
                        if (material.name === targetMaterialName) {
                            tvScreenMaterialFound = true;
                            applyVideoTextureToMaterial(material);
                        }
                    });
                } else if (child.material && child.material.name === targetMaterialName) {
                    tvScreenMaterialFound = true;
                    applyVideoTextureToMaterial(child.material);
                }
            }
        });
        if (!tvScreenMaterialFound) {
             console.warn(`Material layar TV ('${targetMaterialName}') TIDAK ditemukan. Video tidak akan diputar di layar. PASTIKAN SUDAH EDIT MODEL TV DI BLENDER DAN NAMA MATERIAL SUDAH BENAR DI KODE INI.`);
        }
    }, undefined, (error) => console.error('Error loading TV:', error));
}

function loadFanModel() {
    const gltfLoader = new GLTFLoader();
    gltfLoader.load('assets/models/fan/ceiling_fan.gltf', (gltf) => {
        fan = gltf.scene;
        fanBlades = fan.getObjectByName("ceiling_fan_blades");

        // Posisi Kipas di "langit-langit"
        fan.position.set(0, 2.6, 0); // Sesuaikan ketinggian Y dan posisi X, Z
        // fan.scale.set(0.8, 0.8, 0.8);
        // Jika model kipasnya terbalik (misalnya, bagian bawahnya malah di atas), putar:
        // fan.rotation.x = Math.PI; // Putar 180 derajat pada sumbu X

        fan.traverse(child => { if (child.isMesh) child.castShadow = true; });
        scene.add(fan);
        console.log("Kipas dimuat di posisi langit-langit.");
        if (!fanBlades) console.error("Baling kipas ('ceiling_fan_blades') tidak ditemukan!");
    }, undefined, (error) => console.error('Error loading fan:', error));
}

// --- Fungsi Helper ---
function getRootObject(object) { // Untuk mendapatkan parent utama model GLTF
    let parent = object;
    while (parent.parent && parent.parent !== scene) {
        parent = parent.parent;
    }
    return parent;
}

function applyVideoTextureToMaterial(material) {
    if (!videoElement) { console.error("applyVideoTexture: Elemen video tidak ada."); return; }
    // if (videoTextureAppliedToScreen && material.map === videoTexture) return; // Cek ini bisa jadi masalah jika material di-dispose/recreate

    videoTexture = new THREE.VideoTexture(videoElement);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.colorSpace = THREE.SRGBColorSpace;

    material.map = videoTexture;
    material.emissiveMap = videoTexture;
    material.emissive = new THREE.Color(0xffffff);
    material.emissiveIntensity = 0.7; // Sedikit lebih terang
    material.needsUpdate = true;
    videoTextureAppliedToScreen = true;
    console.log("VideoTexture berhasil diterapkan ke material:", material.name);
}

// --- Event Handlers ---
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
        const clickedMainObject = getRootObject(intersects[0].object);

        if (clickedMainObject === tv) {
            if (videoElement && tvScreenMaterialFound) {
                if (videoElement.paused) {
                    videoElement.play().catch(e => console.warn("Video play ditolak:", e));
                } else {
                    videoElement.pause();
                }
            } else if (!tvScreenMaterialFound) {
                console.warn("Klik pada TV, tapi material layar tidak siap. Tidak ada video diputar.");
            }
        } else if (clickedMainObject === ball && ballOnTable) {
            ballOnTable = false;
            ballVelocity.set(
                (Math.random() - 0.5) * 0.3,
                -0.2, // Dorongan awal ke bawah
                (Math.random() - 0.5) * 0.3
            );
            console.log("Bola diklik, mulai jatuh!");
        }
    }
}

function onMouseMove(event) {
    if (!fan) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    // Cek intersect hanya dengan kipas (atau bagiannya)
    const intersects = raycaster.intersectObject(fan, true);
    isFanHovered = (intersects.length > 0);
}

// --- Animasi ---
function animateBall(deltaTime) {
    if (!ball || !table) return;

    const ballEffectiveRadius = ballRadius * (ball.scale.y || 1);

    if (!ballOnTable) { // Bola hanya bergerak jika sudah jatuh (ballOnTable = false)
        ballVelocity.y += gravity.y * deltaTime;
        ball.position.x += ballVelocity.x * deltaTime;
        ball.position.y += ballVelocity.y * deltaTime;
        ball.position.z += ballVelocity.z * deltaTime;

        // Deteksi tumbukan dengan lantai
        if (ball.position.y < floorLevel + ballEffectiveRadius) {
            ball.position.y = floorLevel + ballEffectiveRadius;
            ballVelocity.y *= -bounceDamping; // Memantul

            // Gesekan dengan lantai
            ballVelocity.x *= (1 - 0.8 * deltaTime); // Redam gesekan X lebih kuat
            ballVelocity.z *= (1 - 0.8 * deltaTime); // Redam gesekan Z lebih kuat

            // Hentikan jika pantulan sangat kecil
            if (Math.abs(ballVelocity.y) < 0.02 && ball.position.y <= floorLevel + ballEffectiveRadius + 0.005) {
                ballVelocity.y = 0;
                // Jika kecepatan horizontal juga sangat kecil, hentikan total
                if (ballVelocity.lengthSq() < 0.0001) {
                    ballVelocity.set(0,0,0);
                    console.log("Bola berhenti di lantai.");
                    // Di sini kamu bisa set flag misal `ballHasStopped = true;` jika perlu
                }
            }
        }
    }
}

function animateFan() {
    if (isFanHovered && fanBlades) {
        fanBlades.rotation.y += 0.10; // Kecepatan putar disesuaikan
    }
}

function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();

    if (controls) controls.update(); // Update OrbitControls

    animateBall(deltaTime);
    animateFan();

    if (videoTexture && videoElement && !videoElement.paused) {
        videoTexture.needsUpdate = true;
    }

    renderer.render(scene, camera);
}

// --- Jalankan ---
init();
