import {
  initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js"; import { getAuth, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js"; import {   getFirestore, collection, getDocs, addDoc, getDoc, setDoc, deleteDoc, updateDoc, doc, increment, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { INITIAL_STORES } from "./stores-seed.js";
import { EQUIPMENT } from "./equipment-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const el = id => document.getElementById(id);

let currentRole = "";
let currentCategory = "";
let currentEmail = "";
let currentStoreId = "";
let currentStoreName = "";
let currentStoreFormat = "";
let selectedEquipment = "";
let selectedEquipmentLabel = "";
let selectedMaterialType = "";
let selectedBrowseCategory = "";
let materials = [];
let storesCache = [];
let currentOpenMaterial = null;
let editingMaterialId = null;
let currentCanAdd = false;
let currentCanManage = false;
const PRIMARY_ADMIN_EMAIL = "admin@smartid.com";

const ADMIN_STORE_CODE = "9999";


const DASHBOARD_RESET_AT = new Date("2026-08-25T12:34:00+03:00").getTime();
function valueToMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return 0;
}



const TEAM_DISPLAY_NAMES = [
  "Nistor Ionut",
  "Apetrei Andrei",
  "Robert Neagu",
  "Andreea Ianos",
  "Dan Oros",
  "Valentin Surugiu"
];
let usersNameMap = new Map();

async function loadUserNameMap() {
  try {
    const snap = await getDocs(collection(db, "users"));
    usersNameMap = new Map(snap.docs.map(d => {
      const data=d.data();
      return [d.id.toLowerCase(), data.displayName || d.id];
    }));
  } catch { usersNameMap = new Map(); }
}
function displayUser(email) {
  const key=String(email||"").toLowerCase();
  if (key === PRIMARY_ADMIN_EMAIL) return "Admin principal";
  return usersNameMap.get(key) || email || "Necunoscut";
}

const isPrimaryAdmin = () => currentEmail.toLowerCase() === PRIMARY_ADMIN_EMAIL;

async function logTeamActivity(action, material = null, extra = {}) {
  try {
    await addDoc(collection(db, "teamActivity"), {
      email: currentEmail, action,
      materialId: material?.id || extra.materialId || "",
      title: material?.title || extra.title || "",
      type: material?.type || extra.type || "",
      createdAt: serverTimestamp(), ...extra
    });
  } catch (error) { console.warn("Activitatea echipei nu a putut fi înregistrată.", error); }
}


const normRole = value => String(value || "").trim().toLowerCase();
const normCategory = value => {
  const v = String(value || "").trim().toLowerCase();
  return v === "franchise" ? "franciza" : v;
};
const normType = value => {
  const v = String(value || "").trim().toLowerCase();
  if (v === "video") return "videoclip";
  if (v === "procedure") return "procedura";
  return v;
};
const escapeHtml = value => String(value || "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function showPage(id) {
  document.querySelectorAll(".page").forEach(page => page.classList.add("hidden"));
  el(id).classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function ensureStores() {
  try {
    const markerRef = doc(db, "system", "storesSeedV3");
    const marker = await getDoc(markerRef);
    if (marker.exists()) return;

    for (const store of INITIAL_STORES) {
      await setDoc(doc(db, "stores", store.id), store, { merge: true });
    }

    await setDoc(markerRef, {
      imported: true,
      count: INITIAL_STORES.length,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Lista de magazine nu a putut fi importată automat.", error);
  }
}

async function loadMaterials() {
  try {
    const snap = await getDocs(collection(db, "videos"));
    materials = snap.docs.map(item => {
      const data = item.data();
      const categories = Array.isArray(data.categories)
        ? data.categories.map(normCategory)
        : [normCategory(data.category)].filter(Boolean);
      const equipment = Array.isArray(data.equipment)
        ? data.equipment
        : data.equipment ? [data.equipment] : [];

      return {
        id: item.id,
        ...data,
        type: normType(data.type),
        categories,
        equipment
      };
    });
  } catch (error) {
    console.warn("Materialele nu au putut fi încărcate.", error);
    materials = [];
  }
}

function materialAllowed(material) {
  const status = material.status || "approved";
  if (currentRole === "admin") return true;
  if (currentRole === "suport") return status === "approved" && material.categories.includes(selectedBrowseCategory || "suport");
  return status === "approved" && material.categories.includes(currentCategory);
}

async function recordSession() {
  try {
    await addDoc(collection(db, "sessions"), {
      email: currentEmail,
      role: currentRole,
      category: currentCategory,
      storeId: currentStoreId,
      storeName: currentStoreName,
      storeFormat: currentStoreFormat,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Sesiunea nu a putut fi înregistrată.", error);
  }
}


function configureAccountIdentity() {
  const badge = el("userRoleBadge");
  const hero = el("accountHero");
  const sidebarSubtitle = el("sidebarSubtitle");

  // Reset vizibilitate meniu.
  document.querySelectorAll('.side-btn[data-page="dashboardPage"], .side-btn[data-page="usersPage"], .side-btn[data-page="storesPage"]')
    .forEach(btn => btn.classList.toggle("hidden", currentRole !== "admin"));

  // Adăugare/Gestionare rămân strict după drepturile deja existente.
  document.querySelectorAll('[data-permission="add"]').forEach(x => x.classList.toggle("hidden", !currentCanAdd));
  document.querySelectorAll('[data-permission="manage"]').forEach(x => x.classList.toggle("hidden", !currentCanManage));

  if (currentRole === "admin") {
    badge?.classList.add("hidden");
    if (sidebarSubtitle) sidebarSubtitle.textContent = "Administrare SmartID Portal";
    if (hero) hero.innerHTML = "";
    return;
  }

  if (sidebarSubtitle) sidebarSubtitle.textContent = "Navigare SmartID Portal";
  badge?.classList.remove("hidden");

  if (currentRole === "suport") {
    document.body.classList.add("role-suport");
    badge.textContent = "SUPORT";
    badge.dataset.role = "suport";
    el("equipmentPageTitle").textContent = "SUPORT";
    el("carrefourBrand").classList.add("hidden");
    el("storeWelcome").textContent = "";
    if (hero) hero.innerHTML = "";
    renderPortalLandingForRole();
  } else if (currentRole === "franciza") {
    document.body.classList.remove("role-suport");
    badge.textContent = "FRANCIZĂ";
    badge.dataset.role = "franciza";
    el("equipmentPageTitle").textContent = "FRANCIZĂ";
    el("carrefourBrand").classList.add("hidden");
    if (hero) hero.innerHTML = "";
  } else {
    document.body.classList.remove("role-suport");
    badge.textContent = "CARREFOUR";
    badge.dataset.role = "carrefour";
    el("equipmentPageTitle").textContent = "CARREFOUR";
    el("carrefourBrand").classList.add("hidden");
    if (hero) hero.innerHTML = "";
  }
}


function normalizePortalRole(role, email) {
  const e = String(email || "").trim().toLowerCase();
  const r = String(role || "").trim().toLowerCase();
  if (e === String(PRIMARY_ADMIN_EMAIL || "").trim().toLowerCase()) return "admin";
  if (r === "suport" || r === "support" || e.includes("suport") || e.includes("support")) return "suport";
  if (r === "franciza" || r === "franciză") return "franciza";
  if (r === "carrefour") return "carrefour";
  return r || "carrefour";
}

async function finishLogin() {
  currentRole = normalizePortalRole(currentRole, currentEmail);
  await ensureStores();
  await loadMaterials();
  await recordSession();

  el("loginPage").style.display = "none";
  el("app").classList.remove("hidden");
  el("menuBtn").classList.remove("hidden");
  document.querySelectorAll('[data-permission="add"]').forEach(x => x.classList.toggle("hidden", !currentCanAdd));
  document.querySelectorAll('[data-permission="manage"]').forEach(x => x.classList.toggle("hidden", !currentCanManage));
  document.querySelectorAll('[data-permission="users"]').forEach(x => x.classList.toggle("hidden", !isPrimaryAdmin()));
  el("adminCategoryChooser").classList.toggle("hidden", currentRole !== "admin");
  configureAccountIdentity();
  if (currentRole === "suport") {
    renderPortalLandingForRole();
    el("supportBuildMarker")?.classList.remove("hidden");
  }

  if (currentRole === "admin") {
    await loadDashboard();
    showPage(currentRole === "admin" ? "dashboardPage" : "equipmentPage");
  } else {
    renderEquipment();
    showPage("equipmentPage");
  }
}


async function applyAuthenticatedUser(user, { restored = false } = {}) {
  currentEmail = (user?.email || "").toLowerCase();
  if (!currentEmail) throw new Error("Contul autentificat nu are adresă de email.");

  const profileSnap = await getDoc(doc(db, "users", currentEmail));
  if (!profileSnap.exists()) throw new Error("Contul nu are rol atribuit în Firestore.");

  const profile = profileSnap.data();
  currentRole = normRole(profile.role);
  currentCanAdd = profile.canAdd === true || ["admin","suport"].includes(currentRole);
  currentCanManage = profile.canManage === true || currentRole === "admin";
  currentCategory = currentRole === "suport" ? "suport" : normCategory(profile.category);

  if (!["admin", "suport", "carrefour", "franciza"].includes(currentRole)) {
    throw new Error("Rolul utilizatorului nu este valid.");
  }

  if (currentRole === "admin" || currentRole === "suport") {
    await finishLogin();
  } else {
    await ensureStores();
    el("loginPage").style.display = "none";
    el("storeModal").classList.add("open");
    el("storeCode").value = "";
    el("storeCode").focus();
    setTimeout(recommendStoreByLocation, 250);
  }
}

async function login() {
  el("loginError").textContent = "";
  el("loginBtn").disabled = true;
  el("loginBtn").textContent = "Se autentifică...";

  try {
    await setPersistence(auth, browserLocalPersistence);
    const credential = await signInWithEmailAndPassword(
      auth,
      el("email").value.trim().toLowerCase(),
      el("password").value
    );
    await applyAuthenticatedUser(credential.user);
  } catch (error) {
    const messages = {
      "auth/invalid-credential": "Email sau parolă incorectă.",
      "auth/invalid-login-credentials": "Email sau parolă incorectă.",
      "auth/invalid-email": "Adresa de email nu este validă.",
      "auth/too-many-requests": "Prea multe încercări. Încearcă mai târziu."
    };
    el("loginError").textContent = messages[error.code] || error.message || "Autentificarea nu a reușit.";
  } finally {
    el("loginBtn").disabled = false;
    el("loginBtn").textContent = "Autentificare";
  }
}

async function continueWithStore() {
  const code = el("storeCode").value.trim();
  el("storeError").textContent = "";
  if (!code) {
    el("storeError").textContent = "Introdu ID-ul magazinului.";
    return;
  }

  if (currentRole === "admin" && code === ADMIN_STORE_CODE) {
    if (!["carrefour","franciza"].includes(currentCategory)) currentCategory = "carrefour";
    currentStoreId = "";
    currentStoreName = currentCategory === "franciza" ? "Admin Franciză" : "Admin Carrefour";
    currentStoreFormat = "";
    el("storeModal").classList.remove("open");
    await loadMaterials();
    renderEquipment();
    showPage("equipmentPage");
    return;
  }

  let store = null;
  try {
    const snap = await getDoc(doc(db, "stores", code));
    if (snap.exists()) store = snap.data();
  } catch (error) {
    console.warn(error);
  }

  if (!store) store = INITIAL_STORES.find(item => String(item.id) === code) || null;
  if (!store) {
    el("storeError").textContent = "ID-ul magazinului nu există.";
    return;
  }
  if (store.active === false) {
    el("storeError").textContent = "Magazinul este inactiv.";
    return;
  }

  const storeCategory = normCategory(store.category || store.type);
  if (currentCategory !== "all" && storeCategory !== currentCategory) {
    el("storeError").textContent = "Magazinul nu corespunde categoriei contului.";
    return;
  }

  currentStoreId = code;
  currentStoreName = store.name || code;
  currentStoreFormat = store.format || "";
  el("storeModal").classList.remove("open");
  await finishLogin();

  showPage(currentRole === "admin" ? "dashboardPage" : "equipmentPage");
}


function supportMaterialsFor(category, equipmentId, type = "") {
  return materials
    .filter(material => {
      const status = material.status || "approved";
      const cats = Array.isArray(material.categories) ? material.categories.map(normCategory) : [];
      const eq = Array.isArray(material.equipment) ? material.equipment : [];
      return status === "approved"
        && cats.includes(category)
        && eq.includes(equipmentId)
        && (!type || normType(material.type) === type);
    })
    .sort((a,b) => Number(b.views || 0) - Number(a.views || 0));
}

function renderPortalLandingForRole() {
  const landing = el("supportPortalLanding");
  const standard = el("standardTypeGrid");
  if (!landing || !standard) return;

  if (currentRole === "admin") {
    landing.classList.add("hidden");
    standard.classList.remove("hidden");
    standard.style.removeProperty("display");
    return;
  }

  standard.classList.add("hidden");
  standard.style.setProperty("display", "none", "important");
  landing.classList.remove("hidden");

  const allSections = [
    {
      category: "carrefour",
      title: "CARREFOUR",
      logo: "carrefour-logo.svg",
      visualClass: "support-card-carrefour"
    },
    {
      category: "franciza",
      title: "FRANCIZĂ",
      logo: "carrefour-express-verde-vertical.png",
      visualClass: "support-card-franciza"
    },
    {
      category: "suport",
      title: "SUPORT INTERN",
      logo: "smartid-logo-user.png",
      visualClass: "support-card-intern"
    }
  ];

  let sections = allSections;
  if (currentRole === "carrefour") sections = allSections.filter(s => s.category === "carrefour");
  if (currentRole === "franciza") sections = allSections.filter(s => s.category === "franciza");

  landing.innerHTML = `
    <div class="support-zone-stack ${sections.length === 1 ? "single-zone" : ""}">
      ${sections.map(section => {
        let equipment = EQUIPMENT[section.category] || [];

        // În pagina Suport, SGR nu apare în Franciză.
        if (currentRole === "suport" && section.category === "franciza") {
          equipment = equipment.filter(item => item.id !== "sgr");
        }

        const typeBlocks = [
          { type:"videoclip", label:"Videoclipuri", icon:"▶", iconClass:"type-video" },
          { type:"procedura", label:"Proceduri", icon:"▤", iconClass:"type-procedure" }
        ];

        return `
          <section class="support-zone-card ${section.visualClass}">
            <div class="support-zone-visual">
              <div class="support-zone-glow"></div>
              <img src="${section.logo}" alt="${section.title}">
            </div>

            <div class="support-zone-content">
              <div class="support-zone-title">
                <h3>${section.title}</h3>
              </div>

              <div class="support-type-list">
                ${typeBlocks.map((block, index) => {
                  const total = equipment.reduce((sum, item) =>
                    sum + supportMaterialsFor(section.category, item.id, block.type).length, 0);

                  return `
                    <div class="support-type-group">
                      <button type="button" class="support-type-row" data-type-toggle>
                        <span class="support-type-icon ${block.iconClass}">${block.icon}</span>
                        <span class="support-type-name">${block.label}</span>
                        <span class="support-type-total">${total}</span>
                        <span class="support-type-arrow">⌄</span>
                      </button>

                      <div class="support-type-equipment">
                        ${equipment.map(item => {
                          const count = supportMaterialsFor(section.category, item.id, block.type).length;
                          return `
                            <button type="button"
                                    class="support-equipment-row support-equipment-subrow"
                                    data-support-category="${section.category}"
                                    data-support-equipment="${item.id}"
                                    data-support-label="${escapeHtml(item.label)}"
                                    data-support-type="${block.type}">
                              <span class="support-equipment-icon">${item.icon}</span>
                              <span class="support-equipment-name">${escapeHtml(item.label)}</span>
                              <span class="support-count">${count} ${block.type === "videoclip" ? "videoclipuri" : "proceduri"}</span>
                              <span class="support-row-arrow">›</span>
                            </button>`;
                        }).join("")}
                      </div>
                    </div>`;
                }).join("")}
              </div>
            </div>
          </section>`;
      }).join("")}
    </div>
  `;

  landing.querySelectorAll("[data-type-toggle]").forEach(button => {
    button.onclick = () => {
      const group = button.closest(".support-type-group");
      group?.classList.toggle("open");
    };
  });

  landing.querySelectorAll("[data-support-equipment]").forEach(button => {
    button.onclick = () => {
      selectedBrowseCategory = button.dataset.supportCategory || currentCategory;
      selectedEquipment = button.dataset.supportEquipment || "";
      selectedEquipmentLabel = button.dataset.supportLabel || "";
      selectedMaterialType = button.dataset.supportType || "procedura";
      renderSelectedMaterials();
      showPage("materialsPage");
    };
  });
}

function openSupportDocsModal(category, equipmentId, label, selectedType = "") {
  const modal = el("supportDocsModal");
  if (!modal) return;

  const zoneNames = {
    carrefour: "CARREFOUR",
    franciza: "FRANCIZĂ",
    suport: "SUPORT INTERN"
  };

  const procedures = supportMaterialsFor(category, equipmentId, "procedura");
  const videos = supportMaterialsFor(category, equipmentId, "videoclip");

  el("supportDocsZone").textContent = zoneNames[category] || category;
  el("supportDocsZone").dataset.zone = category;
  el("supportDocsTitle").textContent = label;
  el("supportDocsSubtitle").textContent =
    `${procedures.length} proceduri · ${videos.length} videoclipuri`;

  const makeRows = (items, type) => items.length ? items.map(material => `
    <button type="button" class="support-doc-row" data-support-material="${material.id}">
      <span class="support-doc-icon">${type === "videoclip" ? "▶" : "▤"}</span>
      <span class="support-doc-copy">
        <b>${escapeHtml(material.title || "Material")}</b>
        <small>${escapeHtml(material.description || (type === "videoclip" ? "Videoclip" : "Procedură"))}</small>
      </span>
      <span class="support-doc-views">👁 ${Number(material.views || 0)}</span>
      <span class="support-doc-open">Deschide ›</span>
    </button>
  `).join("") : `<div class="support-doc-empty">Nu există încă ${type === "videoclip" ? "videoclipuri" : "proceduri"} pentru acest echipament.</div>`;

  el("supportDocsBody").innerHTML = `
    ${selectedType !== "videoclip" ? `
      <section class="support-doc-section">
        <div class="support-doc-section-title"><span>▤</span><h3>Proceduri</h3><b>${procedures.length}</b></div>
        <div class="support-doc-list">${makeRows(procedures, "procedura")}</div>
      </section>` : ""}
    ${selectedType !== "procedura" ? `
      <section class="support-doc-section">
        <div class="support-doc-section-title"><span>▶</span><h3>Videoclipuri</h3><b>${videos.length}</b></div>
        <div class="support-doc-list">${makeRows(videos, "videoclip")}</div>
      </section>` : ""}
  `;

  el("supportDocsBody").querySelectorAll("[data-support-material]").forEach(button => {
    button.onclick = () => {
      const material = materials.find(m => String(m.id) === String(button.dataset.supportMaterial));
      if (!material) return;
      closeSupportDocsModal();
      openViewer(material);
    };
  });

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-lock");
}

function closeSupportDocsModal() {
  const modal = el("supportDocsModal");
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-lock");
}


function renderEquipment() {
  if (currentRole !== "admin") {
    renderPortalLandingForRole();
    return;
  }

  const category = currentCategory === "franciza" ? "franciza" : "carrefour";
  const items = EQUIPMENT[category] || [];

  if (category === "franciza") {
    el("equipmentPageTitle").textContent = "FRANCIZĂ";
  } else {
    el("equipmentPageTitle").innerHTML = '<span class="carrefour-title"><img src="carrefour-logo.svg" alt="Carrefour"><span>Carrefour</span></span>';
  }

  el("carrefourBrand").classList.toggle("hidden", category !== "carrefour");
  el("storeWelcome").textContent = currentStoreName
    ? `${currentStoreName}${currentStoreFormat ? ` · ${currentStoreFormat[0].toUpperCase()}${currentStoreFormat.slice(1)}` : ""}`
    : "";

  el("equipmentGrid").innerHTML = items.map(item => `
    <article class="equipment-card" data-equipment="${item.id}" data-label="${escapeHtml(item.label)}">
      <div class="equipment-icon">${item.icon}</div>
      <h2>${escapeHtml(item.label)}</h2>
      <p>Alege materialele pentru acest echipament.</p>
    </article>
  `).join("");

  document.querySelectorAll(".equipment-card").forEach(card => {
    card.addEventListener("click", () => {
      selectedEquipment = card.dataset.equipment;
      selectedEquipmentLabel = card.dataset.label;
      selectedBrowseCategory = category;
      showPage("materialTypePage");
    });
  });
}

function youtubeId(raw) {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.hostname.includes("youtu.be")) return url.pathname.replace("/", "").split("/")[0];
    if (url.hostname.includes("youtube.com")) {
      if (url.pathname.startsWith("/embed/")) return url.pathname.split("/embed/")[1].split("/")[0];
      if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/shorts/")[1].split("/")[0];
      return url.searchParams.get("v") || "";
    }
  } catch {}
  return "";
}

function renderSelectedMaterials() {
  const term = el("searchInput").value.trim().toLowerCase();
  const list = materials.filter(material => {
    const text = `${material.title || ""} ${material.description || ""} ${material.tags || ""}`.toLowerCase();
    return materialAllowed(material)
      && material.type === selectedMaterialType
      && material.equipment.includes(selectedEquipment)
      && (!term || text.includes(term));
  });

  const sorted = [...list].sort((a, b) => {
    const byViews = Number(b.views || 0) - Number(a.views || 0);
    if (byViews !== 0) return byViews;
    return String(a.title || "").localeCompare(String(b.title || ""), "ro");
  });

  el("materialsTitle").textContent = selectedMaterialType === "videoclip" ? "Videoclipuri" : "Proceduri";
  el("materialsSubtitle").textContent = `${selectedEquipmentLabel} · în ordinea celor mai vizionate`;

  const makeCard = (material, position) => {
    const yt = youtubeId(material.url || "");
    const preview = material.type === "videoclip" && yt
      ? `<div class="thumb"><img src="https://img.youtube.com/vi/${yt}/hqdefault.jpg" alt=""><div class="play">▶</div></div>`
      : `<div class="thumb">▣</div>`;

    const card = document.createElement("article");
    card.className = "material-card ranked-material";
    card.innerHTML = `
      <div class="rank-badge">#${position}</div>
      ${preview}
      <div class="material-body">
        <h3>${escapeHtml(material.title || "Material")}</h3>
        <p>${escapeHtml(material.description || "")}</p>
        <div class="material-info">👁 ${Number(material.views || 0)} vizualizări</div>
      </div>`;
    card.addEventListener("click", () => openViewer(material));
    return card;
  };

  const grid = el("materialsGrid");
  grid.innerHTML = "";

  if (!sorted.length) {
    grid.innerHTML = `<div class="empty">${escapeHtml(
      selectedMaterialType === "videoclip"
        ? `Nu există încă videoclipuri disponibile pentru ${selectedEquipmentLabel}.`
        : `Nu există încă proceduri disponibile pentru ${selectedEquipmentLabel}.`
    )}</div>`;
  } else {
    sorted.forEach((material, index) => grid.appendChild(makeCard(material, index + 1)));
  }
}

function driveSamePageUrl(raw) {
  if (!raw) return "about:blank";
  try {
    const u = new URL(raw);
    if (u.hostname.includes("drive.google.com")) {
      const m = u.pathname.match(/\/file\/d\/([^/]+)/);
      if (m) {
        const download = `https://drive.google.com/uc?export=download&id=${m[1]}`;
        return `https://docs.google.com/gview?embedded=1&url=${encodeURIComponent(download)}`;
      }
    }
  } catch {}
  return raw;
}
async function openViewer(material) {
  currentOpenMaterial = material;
  el("viewerTitle").textContent = material.title || "Material";
  const yt = youtubeId(material.url || "");
  el("viewerFrame").src = material.type === "videoclip" && yt ? `https://www.youtube-nocookie.com/embed/${yt}?rel=0&cc_load_policy=0&playsinline=1` : driveSamePageUrl(material.url || "about:blank");
  el("viewer").classList.add("open");
  try {
    await addDoc(collection(db,"materialViews"),{materialId:material.id,title:material.title||"",type:material.type,email:currentEmail,storeId:currentStoreId,storeName:currentStoreName,storeFormat:currentStoreFormat,createdAt:serverTimestamp()});
    await updateDoc(doc(db,"videos",material.id),{views:increment(1)}); material.views=Number(material.views||0)+1;
  } catch(error){console.warn("Vizualizarea nu a putut fi înregistrată.",error);}
}

function renderEquipmentChoices() {
  for (const category of ["carrefour", "franciza", "suport"]) {
    el(`${category}EquipmentChoices`).innerHTML = EQUIPMENT[category].map(item => `
      <label><input type="checkbox" name="${category}Equipment" value="${item.id}"> ${escapeHtml(item.label)}</label>
    `).join("");
  }
}

async function saveMaterial() {
  const title = el("materialTitle").value.trim();
  const url = el("materialUrl").value.trim();
  const type = el("materialType").value;
  const categories = [...document.querySelectorAll('input[name="materialCategory"]:checked')].map(input => input.value);
  const equipment = [
    ...document.querySelectorAll('input[name="carrefourEquipment"]:checked'),
    ...document.querySelectorAll('input[name="francizaEquipment"]:checked'),
    ...document.querySelectorAll('input[name="suportEquipment"]:checked')
  ].map(input => input.value);

  if (!title || !url) {
    el("materialStatus").textContent = "Completează titlul și linkul.";
    return;
  }
  if (!categories.length) {
    el("materialStatus").textContent = "Selectează cel puțin o categorie.";
    return;
  }
  if (!equipment.length) {
    el("materialStatus").textContent = "Selectează cel puțin un echipament.";
    return;
  }

  const payload = {
    title,
    url,
    type,
    categories,
    equipment,
    description: el("materialDescription").value.trim(),
    tags: el("materialTags").value.trim().toLowerCase(),
    updatedAt: serverTimestamp(),
    updatedBy: currentEmail
  };

  if (editingMaterialId) {
    await updateDoc(doc(db, "videos", editingMaterialId), {
      ...payload,
      status: isPrimaryAdmin() ? (materials.find(x=>x.id===editingMaterialId)?.status || "approved") : "pending"
    });
    await logTeamActivity("material_edited", null, {materialId:editingMaterialId,title,type});
    el("materialStatus").textContent = isPrimaryAdmin() ? "Modificările au fost salvate." : "Modificările au fost retrimise spre aprobare.";
  } else {
    const initialStatus = isPrimaryAdmin() ? "approved" : "pending";
    const createdRef = await addDoc(collection(db, "videos"), {
      ...payload, status: initialStatus, views: 0,
      createdAt: serverTimestamp(), createdBy: currentEmail,
      approvedBy: isPrimaryAdmin() ? currentEmail : "",
      approvedAt: isPrimaryAdmin() ? serverTimestamp() : null
    });
    await logTeamActivity("material_added", null, {materialId:createdRef.id,title,type,status:initialStatus});
    el("materialStatus").textContent = isPrimaryAdmin()
      ? "Materialul a fost adăugat și publicat."
      : "Materialul a fost trimis spre aprobarea Adminului principal.";
  }

  resetMaterialForm();
  await loadMaterials();
  await renderAdminMaterials();
}

function resetMaterialForm() {
  editingMaterialId = null;
  ["materialTitle", "materialUrl", "materialDescription", "materialTags"].forEach(id => el(id).value = "");
  document.querySelectorAll('#addMaterialPage input[type="checkbox"]').forEach(input => input.checked = false);
  document.querySelector('input[name="materialCategory"][value="carrefour"]').checked = true;
  el("materialType").value = "videoclip";
  el("saveMaterialBtn").textContent = "Adaugă material";
  el("cancelEditMaterialBtn").classList.add("hidden");
}

function startEditMaterial(materialId) {
  const material = materials.find(item => item.id === materialId);
  if (!material) return;

  editingMaterialId = material.id;
  el("materialTitle").value = material.title || "";
  el("materialUrl").value = material.url || "";
  el("materialType").value = material.type || "videoclip";
  el("materialDescription").value = material.description || "";
  el("materialTags").value = material.tags || "";

  document.querySelectorAll('#addMaterialPage input[type="checkbox"]').forEach(input => input.checked = false);

  (material.categories || []).forEach(category => {
    const input = document.querySelector(`input[name="materialCategory"][value="${category}"]`);
    if (input) input.checked = true;
  });

  (material.equipment || []).forEach(eq => {
    document.querySelectorAll(`#addMaterialPage input[type="checkbox"][value="${eq}"]`).forEach(input => {
      if (input.name !== "materialCategory") input.checked = true;
    });
  });

  el("saveMaterialBtn").textContent = "Salvează modificările";
  el("cancelEditMaterialBtn").classList.remove("hidden");
  el("materialStatus").textContent = "Editezi materialul selectat.";
  showPage("addMaterialPage");
  window.scrollTo({top:0, behavior:"smooth"});
}

function showSmartIDToast(message, type = "success") {
  let toast = document.getElementById("smartidToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "smartidToast";
    toast.className = "smartid-toast";
    document.body.appendChild(toast);
  }
  toast.className = `smartid-toast ${type}`;
  toast.textContent = message;
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(window.__smartidToastTimer);
  window.__smartidToastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function renderAdminMaterials() {
  await loadMaterials();
  const container = el("adminMaterialsList");
  if (!materials.length) {
    container.innerHTML = '<div class="empty">Nu există materiale.</div>';
    return;
  }

  const manageTerm = el("manageMaterialSearch") ? el("manageMaterialSearch").value.trim().toLowerCase() : "";
  const manageType = el("manageMaterialType") ? el("manageMaterialType").value : "all";
  const managed = materials.filter(m => (!manageTerm || `${m.title||""} ${m.tags||""}`.toLowerCase().includes(manageTerm)) && (manageType === "all" || m.type === manageType));
  container.innerHTML = managed.map(material => {
    const tags = material.tags ? `<div class="material-tags">🏷 ${escapeHtml(material.tags)}</div>` : '<div class="material-tags">🏷 Fără tag-uri</div>';
    const views = Number(material.views || 0);
    return `
      <div class="admin-material-row">
        <b>${escapeHtml(material.title || "Material")}</b>
        <span class="badge">${material.type === "videoclip" ? "Videoclip" : "Procedură"}</span>
        <div class="store-meta">${escapeHtml((material.categories || []).join(", "))} · ${escapeHtml((material.equipment || []).join(", "))}</div>
        ${tags}
        <div class="material-info">👁 ${views} vizualizări${material.createdBy ? ` · Adăugat de ${escapeHtml(material.createdBy)}` : ""}</div>
        <div class="approval-line"><span class="status-badge status-${escapeHtml(material.status || "approved")}">${
          (material.status || "approved") === "pending" ? "În așteptare" : (material.status || "approved") === "rejected" ? "Respins" : "Aprobat"
        }</span></div>
        <div class="row-actions">
          <button class="secondary edit-material-btn" data-edit-material="${material.id}">✏️ Editează</button>
          ${isPrimaryAdmin() && (material.status || "approved") !== "approved" ? `<button class="primary" data-approve-material="${material.id}">✓ Aprobă</button>` : ""}
          ${isPrimaryAdmin() && (material.status || "approved") !== "rejected" ? `<button class="secondary" data-reject-material="${material.id}">Respinge</button>` : ""}
          ${isPrimaryAdmin() ? `<button class="danger" data-delete-material="${material.id}">Șterge</button>` : ""}
        </div>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-edit-material]").forEach(button => {
    button.addEventListener("click", () => startEditMaterial(button.dataset.editMaterial));
  });

  container.querySelectorAll("[data-approve-material]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!isPrimaryAdmin()) return;
      const material=materials.find(x=>x.id===button.dataset.approveMaterial);
      await updateDoc(doc(db,"videos",button.dataset.approveMaterial),{status:"approved",approvedBy:currentEmail,approvedAt:serverTimestamp()});
      await logTeamActivity("material_approved",material);
      showSmartIDToast("Material aprobat și publicat.");
      await renderAdminMaterials(); await loadDashboard();
    });
  });
  container.querySelectorAll("[data-reject-material]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!isPrimaryAdmin()) return;
      const material=materials.find(x=>x.id===button.dataset.rejectMaterial);
      await updateDoc(doc(db,"videos",button.dataset.rejectMaterial),{status:"rejected",approvedBy:currentEmail,approvedAt:serverTimestamp()});
      await logTeamActivity("material_rejected",material);
      await renderAdminMaterials(); await loadDashboard();
    });
  });

  container.querySelectorAll("[data-delete-material]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Ștergi materialul?")) return;
      const material=materials.find(x=>x.id===button.dataset.deleteMaterial);
      await deleteDoc(doc(db, "videos", button.dataset.deleteMaterial));
      await logTeamActivity("material_deleted",material);
      if (editingMaterialId === button.dataset.deleteMaterial) resetMaterialForm();
      await renderAdminMaterials();
    });
  });
}


function dashboardTimestamp(value) {
  const ms = value && typeof value.toMillis === "function" ? value.toMillis() : (value?.seconds ? value.seconds * 1000 : 0);
  return ms ? new Date(ms).toLocaleString("ro-RO") : "—";
}
function openDashboardDetails(title, subtitle, rows) {
  el("dashboardDetailsTitle").textContent = title;
  el("dashboardDetailsSubtitle").textContent = subtitle || "";
  el("dashboardDetailsBody").innerHTML = rows.length ? rows.map(row => `
    <div class="dashboard-detail-row">
      <div class="dashboard-detail-main"><b>${escapeHtml(row.title || "—")}</b><span>${escapeHtml(row.detail || "")}</span></div>
      <small>${escapeHtml(row.when || "")}</small>
    </div>`).join("") : '<div class="empty">Nu există încă informații.</div>';
  el("dashboardDetailsModal").classList.add("open");
}



let dashboardDetailCache = { sessions: [], views: [], shares: [], teamActivity: [] };

function exportDashboardExcel(filename, headers, rows) {
  const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const all=[headers,...rows];
  const html=`<html><head><meta charset="UTF-8"></head><body><table>${all.map((r,i)=>`<tr>${r.map(c=>`<${i?"td":"th"}>${esc(c)}</${i?"td":"th"}>`).join("")}</tr>`).join("")}</table></body></html>`;
  const blob=new Blob([html],{type:"application/vnd.ms-excel;charset=utf-8"});
  const u=URL.createObjectURL(blob), a=document.createElement("a"); a.href=u; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(u),500);
}
function topVideoStats(views) {
  const map=new Map();
  views.filter(x=>normType(x.type)==="videoclip").forEach(x=>{
    const key=String(x.title||"Videoclip").trim()||"Videoclip";
    const v=map.get(key)||{title:key,count:0,last:null,users:new Set(),stores:new Set()};
    v.count++; if(x.email)v.users.add(displayUser(x.email)); if(x.storeName)v.stores.add(x.storeName);
    if(!v.last || valueToMillis(x.createdAt)>valueToMillis(v.last))v.last=x.createdAt; map.set(key,v);
  });
  return [...map.values()].sort((a,b)=>b.count-a.count || valueToMillis(b.last)-valueToMillis(a.last));
}

function setupDashboardInteractions() {
  document.querySelectorAll("[data-stat-details]").forEach(button => {
    button.onclick = async event => {
      event.preventDefault();
      event.stopPropagation();

      const key = button.dataset.statDetails;
      const { sessions, views, shares } = dashboardDetailCache;

      if (key === "logins") {
        openDashboardDetails(
          "Autentificări",
          "Cine s-a autentificat, magazinul și momentul accesării.",
          [...sessions]
            .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
            .map(x=>({
              title: displayUser(x.email),
              detail: x.storeName ? `${x.storeName}${x.storeId ? ` · ID ${x.storeId}` : ""}` : (x.role || ""),
              when: dashboardTimestamp(x.createdAt)
            }))
        );
      } else if (key === "stores") {
        const storeMap = new Map();
        sessions.forEach(x => {
          if (!x.storeId && !x.storeName) return;
          const k = x.storeId || x.storeName;
          const v = storeMap.get(k) || { name:x.storeName || "Magazin", id:x.storeId || "", count:0, last:x.createdAt };
          v.count++;
          if ((x.createdAt?.seconds||0) > (v.last?.seconds||0)) v.last = x.createdAt;
          storeMap.set(k, v);
        });

        openDashboardDetails(
          "Magazine active",
          "Magazinele care au accesat SmartID Portal.",
          [...storeMap.values()]
            .sort((a,b)=>b.count-a.count)
            .map(x=>({
              title:`${x.name}${x.id ? ` · ID ${x.id}` : ""}`,
              detail:`${x.count} autentificări`,
              when:`Ultima accesare: ${dashboardTimestamp(x.last)}`
            }))
        );
      } else if (key === "videos") {
        const top5=topVideoStats(views);
        openDashboardDetails(
          "Toate videoclipurile · ordonate după accesări",
          "Toate videoclipurile, de la cele mai accesate la cele mai puțin accesate. Pentru fiecare vezi numărul de accesări, utilizatorii și ultima vizualizare.",
          top5.map((x,i)=>({
            title:`${i+1}. ${x.title}`,
            detail:`${x.count} vizualizări · ${x.users.size} utilizatori${x.stores.size ? ` · ${x.stores.size} magazine` : ""} · ${[...x.users].slice(0,5).join(", ")}${x.users.size>5 ? "…" : ""}`,
            when:`Ultima vizualizare: ${dashboardTimestamp(x.last)}`
          }))
        );
      } else if (key === "procedures") {
        const procedureMap = new Map();
        views.filter(x=>normType(x.type)==="procedura").forEach(x=>{
          const key=String(x.title||"Procedură").trim()||"Procedură";
          const v=procedureMap.get(key)||{title:key,count:0,last:null,users:new Set(),stores:new Set()};
          v.count++; if(x.email)v.users.add(displayUser(x.email)); if(x.storeName)v.stores.add(x.storeName);
          if(!v.last || valueToMillis(x.createdAt)>valueToMillis(v.last))v.last=x.createdAt; procedureMap.set(key,v);
        });
        const allProcedures=[...procedureMap.values()].sort((a,b)=>b.count-a.count || valueToMillis(b.last)-valueToMillis(a.last));
        openDashboardDetails(
          "Toate procedurile · ordonate după accesări",
          "Toate procedurile, de la cele mai accesate la cele mai puțin accesate.",
          allProcedures.map((x,i)=>({
            title:`${i+1}. ${x.title}`,
            detail:`${x.count} vizualizări · ${x.users.size} utilizatori${x.stores.size ? ` · ${x.stores.size} magazine` : ""}`,
            when:`Ultima vizualizare: ${dashboardTimestamp(x.last)}`
          }))
        );
      } else if (key === "shares") {
        openDashboardDetails(
          "Distribuiri",
          "Materialele distribuite, cine le-a trimis și metoda folosită.",
          [...shares]
            .sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
            .map(x=>({
              title:x.title || "Material",
              detail:`${displayUser(x.email)} · ${x.method || x.channel || "Distribuire"}`,
              when:dashboardTimestamp(x.createdAt)
            }))
        );
      } else if (key === "pending") {
        const pending = materials.filter(m => (m.status || "approved") === "pending");
        openDashboardDetails(
          "Materiale de aprobat",
          "Materialele încărcate de echipă care așteaptă aprobarea Adminului principal.",
          pending.map(m=>({
            title:m.title || "Material",
            detail:`${normType(m.type)==="videoclip" ? "Videoclip" : "Procedură"} · ${displayUser(m.createdBy)}`,
            when:dashboardTimestamp(m.createdAt)
          }))
        );
      }
    };
  });
  document.querySelectorAll("[data-stat-export]").forEach(button=>{
    button.onclick=event=>{
      event.preventDefault(); event.stopPropagation();
      const key=button.dataset.statExport, {sessions,views,shares}=dashboardDetailCache;
      if(key==="logins") exportDashboardExcel("Autentificari_SmartID.xls",["Utilizator","Magazin","ID magazin","Rol","Data/Ora"],[...sessions].sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt)).map(x=>[displayUser(x.email),x.storeName||"",x.storeId||"",x.role||"",dashboardTimestamp(x.createdAt)]));
      if(key==="stores"){
        const m=new Map(); sessions.forEach(x=>{if(!x.storeId&&!x.storeName)return;const k=x.storeId||x.storeName,v=m.get(k)||{name:x.storeName||"Magazin",id:x.storeId||"",count:0,last:x.createdAt};v.count++;if(valueToMillis(x.createdAt)>valueToMillis(v.last))v.last=x.createdAt;m.set(k,v)});
        exportDashboardExcel("Magazine_active_SmartID.xls",["Magazin","ID","Autentificări","Ultima accesare"],[...m.values()].sort((a,b)=>b.count-a.count).map(x=>[x.name,x.id,x.count,dashboardTimestamp(x.last)]));
      }
      if(key==="videos") exportDashboardExcel("Top_5_videoclipuri_SmartID.xls",["Loc","Videoclip","Vizualizări","Utilizatori","Magazine","Ultima vizualizare"],topVideoStats(views).map((x,i)=>[i+1,x.title,x.count,[...x.users].join(", "),[...x.stores].join(", "),dashboardTimestamp(x.last)]));
      if(key==="procedures") exportDashboardExcel("Proceduri_SmartID.xls",["Procedură","Utilizator","Magazin","Data/Ora"],[...views].filter(x=>normType(x.type)==="procedura").sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt)).map(x=>[x.title||"Procedură",displayUser(x.email),x.storeName||"",dashboardTimestamp(x.createdAt)]));
      if(key==="shares") exportDashboardExcel("Distribuiri_SmartID.xls",["Material","Utilizator","Metodă","Data/Ora"],[...shares].sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt)).map(x=>[x.title||"Material",displayUser(x.email),x.method||x.channel||"Distribuire",dashboardTimestamp(x.createdAt)]));
    };
  });
  if (el("approvalNotifyBtn")) el("approvalNotifyBtn").onclick = () => {
    const pending = materials.filter(m => (m.status || "approved") === "pending");
    openDashboardDetails("Materiale de aprobat","Materialele încărcate de echipă care așteaptă aprobarea Adminului principal.",pending.map(m=>({title:m.title||"Material",detail:`${normType(m.type)==="videoclip"?"Videoclip":"Procedură"} · ${displayUser(m.createdBy)}`,when:dashboardTimestamp(m.createdAt)})));
  };
}

async function loadDashboard() {
  try {
    await loadUserNameMap();
    await loadMaterials();

    const [sessionsSnap, viewsSnap, sharesSnap, teamActivitySnap] = await Promise.all([
      getDocs(collection(db, "sessions")),
      getDocs(collection(db, "materialViews")),
      getDocs(collection(db, "shares")),
      getDocs(collection(db, "teamActivity"))
    ]);

    const sessions = sessionsSnap.docs
      .map(item => item.data())
      .filter(item => valueToMillis(item.createdAt) >= DASHBOARD_RESET_AT);

    const views = viewsSnap.docs
      .map(item => item.data())
      .filter(item => valueToMillis(item.createdAt) >= DASHBOARD_RESET_AT);

    const shares = sharesSnap.docs
      .map(item => ({ id: item.id, ...item.data() }))
      .filter(item => valueToMillis(item.createdAt) >= DASHBOARD_RESET_AT);

    const teamActivity = teamActivitySnap.docs.map(item => ({ id:item.id, ...item.data() })).filter(item => valueToMillis(item.createdAt) >= DASHBOARD_RESET_AT);
    dashboardDetailCache = { sessions, views, shares, teamActivity };

    const videoViews = views.filter(item => normType(item.type) === "videoclip").length;
    const procedureViews = views.filter(item => normType(item.type) === "procedura").length;
    const activeStores = new Set(sessions.map(item => item.storeId).filter(Boolean)).size;

    el("statLogins").textContent = sessions.length;
    el("statStores").textContent = activeStores;
    el("statVideos").textContent = videoViews;
    el("statProcedures").textContent = procedureViews;
    el("statShares").textContent = shares.length;
    if (el("topVideoPreview")) {
      const top5=topVideoStats(views);
      el("topVideoPreview").textContent = top5.length ? top5.map((x,i)=>`${i+1}. ${x.title} (${x.count})`).join(" · ") : "Nu există încă vizualizări.";
      el("topVideoPreview").title = el("topVideoPreview").textContent;
    }

    const pendingCount = materials.filter(m => (m.status || "approved") === "pending").length;
    if (el("statPending")) el("statPending").textContent = pendingCount;
    if (el("approvalNotifyCount")) el("approvalNotifyCount").textContent = pendingCount;
    if (el("approvalNotifyBtn")) el("approvalNotifyBtn").classList.toggle("hidden", !isPrimaryAdmin());

    const totalViews = videoViews + procedureViews;
    const videoAngle = totalViews ? (videoViews / totalViews) * 360 : 0;
    if (el("diagramVideos")) el("diagramVideos").textContent = videoViews;
    if (el("diagramProcedures")) el("diagramProcedures").textContent = procedureViews;
    if (el("diagramTotal")) el("diagramTotal").textContent = totalViews;
    if (el("usageDiagram")) {
      el("usageDiagram").style.background = totalViews
        ? `conic-gradient(#6d28d9 0deg ${videoAngle}deg, #c026d3 ${videoAngle}deg 360deg)`
        : "conic-gradient(#e5e7eb 0deg 360deg)";
    }

    // Activitate echipa = doar materiale noi, cu autor cunoscut.
    const recentTeamMaterials = materials.filter(item =>
      valueToMillis(item.createdAt) >= DASHBOARD_RESET_AT &&
      item.createdBy &&
      String(item.createdBy).trim().toLowerCase() !== "necunoscut"
    );

    const byUser = {};
    recentTeamMaterials.forEach(item => {
      const email = item.createdBy;
      byUser[email] ??= { videos: 0, procedures: 0 };
      if (normType(item.type) === "videoclip") byUser[email].videos++;
      if (normType(item.type) === "procedura") byUser[email].procedures++;
    });

    el("teamVideosTotal").textContent =
      recentTeamMaterials.filter(item => normType(item.type) === "videoclip").length;
    el("teamProceduresTotal").textContent =
      recentTeamMaterials.filter(item => normType(item.type) === "procedura").length;

    const contributors = Object.entries(byUser)
      .sort((a,b) => (b[1].videos + b[1].procedures) - (a[1].videos + a[1].procedures));

    el("contributorsList").innerHTML = contributors.length
      ? contributors.map(([email, values]) => `
          <div class="team-member-row" data-team-email="${escapeHtml(email)}">
            <div class="team-member-name">
              <div class="team-avatar">${escapeHtml((displayUser(email) || "?").charAt(0).toUpperCase())}</div>
              <div>
                <b>${escapeHtml(displayUser(email))}</b>
                <small>${values.videos + values.procedures} materiale încărcate</small>
              </div>
            </div>
            <div class="team-metrics">
              <span class="metric-pill video-pill">▶ ${values.videos} videoclipuri</span>
              <span class="metric-pill procedure-pill">▣ ${values.procedures} proceduri</span>
            </div>
          </div>
        `).join("")
      : '<div class="empty">Nu există încă activitate nouă a echipei.</div>';

    const actionLabel = action => ({material_added:"Adăugare",material_edited:"Editare",material_approved:"Aprobare",material_rejected:"Respingere",material_deleted:"Ștergere"}[action] || action || "Activitate");
    const activityByUser = {};
    teamActivity.forEach(a => { const e=String(a.email||""); if(!e) return; (activityByUser[e] ??= []).push(a); });
    const chartUsers = [...new Set([...Object.keys(byUser), ...Object.keys(activityByUser)])];
    const maxActs = Math.max(1, ...chartUsers.map(e => (activityByUser[e]||[]).length));
    if (el("teamCharts")) el("teamCharts").innerHTML = chartUsers.length ? chartUsers.map(email => {
      const acts=(activityByUser[email]||[]).sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt));
      const adds=acts.filter(a=>a.action==="material_added").length, edits=acts.filter(a=>a.action==="material_edited").length;
      return `<div class="team-chart-card"><div class="team-chart-head"><b>${escapeHtml(displayUser(email))}</b><span>${acts.length} acțiuni</span></div><div class="team-bar-row"><span>Total acțiuni</span><div class="team-bar"><i style="width:${Math.max(4,(acts.length/maxActs)*100)}%"></i></div><b>${acts.length}</b></div><div class="team-bar-row"><span>Adăugări</span><div class="team-bar"><i style="width:${acts.length?Math.max(4,(adds/acts.length)*100):0}%"></i></div><b>${adds}</b></div><div class="team-bar-row"><span>Editări</span><div class="team-bar"><i style="width:${acts.length?Math.max(4,(edits/acts.length)*100):0}%"></i></div><b>${edits}</b></div><div class="team-event-list">${acts.slice(0,4).map(a=>`<div><b>${escapeHtml(actionLabel(a.action))}</b> · ${escapeHtml(a.title||"Material")} · ${escapeHtml(dashboardTimestamp(a.createdAt))}</div>`).join("") || "Fără acțiuni înregistrate."}</div></div>`;
    }).join("") : '<div class="empty">Nu există încă activitate înregistrată.</div>';

    const exportBtn=el("exportTeamExcel");
    if(exportBtn) exportBtn.onclick=()=>{
      const rows=[["Utilizator","Acțiune","Material","Tip","Data/Ora"]];
      [...teamActivity].sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt)).forEach(a=>rows.push([displayUser(a.email),actionLabel(a.action),a.title||"",a.type||"",dashboardTimestamp(a.createdAt)]));
      const esc=v=>String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      const html=`<html><head><meta charset="UTF-8"></head><body><table>${rows.map((r,i)=>`<tr>${r.map(c=>`<${i?"td":"th"}>${esc(c)}</${i?"td":"th"}>`).join("")}</tr>`).join("")}</table></body></html>`;
      const blob=new Blob([html],{type:"application/vnd.ms-excel;charset=utf-8"}); const u=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=u; a.download="Activitate_echipa_SmartID.xls"; a.click(); setTimeout(()=>URL.revokeObjectURL(u),500);
    };

    document.querySelectorAll(".team-member-row").forEach(row => {
      row.onclick = () => {
        const email = row.dataset.teamEmail || "";
        const own = recentTeamMaterials
          .filter(m => m.createdBy === email)
          .sort((a,b) => valueToMillis(b.createdAt) - valueToMillis(a.createdAt));

        openDashboardDetails(
          displayUser(email),
          "Materialele încărcate de acest utilizator.",
          own.map(m => ({
            title: m.title || "Material",
            detail: normType(m.type) === "videoclip" ? "Videoclip" : "Procedură",
            when: dashboardTimestamp(m.createdAt)
          }))
        );
      };
    });

    setupDashboardInteractions();
  } catch (error) {
    console.error("Dashboard:", error);
  }
}
async function loadStores() {
  const snap = await getDocs(collection(db, "stores"));
  storesCache = snap.docs.map(item => ({ id: item.id, ...item.data() }));
  renderStores();
}

function renderStores() {
  const term = el("storeSearch").value.trim().toLowerCase();
  const filter = el("storeFilter").value;

  const filtered = storesCache.filter(store => {
    const category = normCategory(store.category || store.type);
    const format = String(store.format || "").toLowerCase();
    const matchesText = !term || `${store.id} ${store.name || ""}`.toLowerCase().includes(term);
    const matchesFilter = filter === "all" || category === filter || format === filter;
    return matchesText && matchesFilter;
  });

  const carrefour = filtered.filter(s => normCategory(s.category || s.type) === "carrefour");
  const franciza = filtered.filter(s => normCategory(s.category || s.type) === "franciza");

  const renderRows = list => list
    .sort((a,b) => String(a.name || "").localeCompare(String(b.name || ""), "ro"))
    .map(store => `
      <div class="store-row ${store.active === false ? "store-row-inactive" : ""}">
        <div class="store-row-main">
          <b>${escapeHtml(store.name || store.id)}</b>
          <div class="store-meta">
            ID: ${escapeHtml(store.id)} ·
            <span class="${store.active === false ? "store-status-inactive" : "store-status-active"}">
              ${store.active === false ? "Inactiv" : "Activ"}
            </span>
          </div>
        </div>
        ${currentRole === "admin" ? `
          <div class="store-row-actions">
            <button type="button" class="store-edit-btn" data-edit-store="${escapeHtml(store.id)}">Edit</button>
            <button type="button" class="store-delete-btn" data-delete-store="${escapeHtml(store.id)}" data-store-name="${escapeHtml(store.name || store.id)}">Șterge</button>
          </div>` : ""}
      </div>
    `).join("");

  const group = (title, list, key) => `
    <div class="group-block">
      <button class="group-head" data-store-group="${key}">
        <span>${title}</span><span>${list.length} ▸</span>
      </button>
      <div class="group-body collapsed" id="group-${key}">
        ${list.length ? renderRows(list) : '<div class="store-row"><small>Nu există magazine.</small></div>'}
      </div>
    </div>`;

  const hiper = carrefour.filter(s => String(s.format || "").toLowerCase() === "hiper");
  const superStores = carrefour.filter(s => String(s.format || "").toLowerCase() === "super");
  const express = carrefour.filter(s => String(s.format || "").toLowerCase() === "express");
  const noFormat = carrefour.filter(s => !["hiper","super","express"].includes(String(s.format || "").toLowerCase()));

  let output = "";
  if (filter !== "franciza") {
    output += '<h2 class="category-title">Carrefour</h2>';
    output += group("Hiper", hiper, "hiper");
    output += group("Super", superStores, "super");
    output += group("Express", express, "express");
    if (noFormat.length) output += group("Fără format", noFormat, "noformat");
  }

  if (filter !== "carrefour" && !["hiper","super","express"].includes(filter)) {
    output += '<h2 class="category-title">Franciză</h2>';
    output += group("Magazine Franciză", franciza, "franciza");
  }

  el("storesList").innerHTML = output || '<div class="empty">Nu există magazine pentru filtrul selectat.</div>';

  el("storesList").querySelectorAll("[data-store-group]").forEach(button => {
    button.addEventListener("click", () => {
      const body = el(`group-${button.dataset.storeGroup}`);
      body.classList.toggle("collapsed");
      const count = body.querySelectorAll(".store-row").length;
      button.querySelector("span:last-child").textContent = `${count} ${body.classList.contains("collapsed") ? "▸" : "▾"}`;
    });
  });

  bindStoreEditButtons();
  bindStoreDeleteButtons();
}



function editStore(storeId) {
  if (currentRole !== "admin") return;
  el("storeEditorPanel")?.classList.remove("hidden");

  const store = storesCache.find(item => String(item.id) === String(storeId));
  if (!store) {
    if (el("saveStoreStatus")) el("saveStoreStatus").textContent = "Magazinul nu a fost găsit.";
    return;
  }

  el("newStoreId").value = store.id || storeId;
  el("newStoreName").value = store.name || "";
  el("newStoreCategory").value = normCategory(store.category || store.type) || "carrefour";
  toggleStoreFormat();

  if (el("newStoreCategory").value === "carrefour") {
    el("newStoreFormat").value = String(store.format || "hiper").toLowerCase();
  }

  el("newStoreActive").value = store.active === false ? "false" : "true";

  if (el("saveStoreStatus")) {
    el("saveStoreStatus").textContent = `Editezi magazinul ${store.name || storeId} · ID ${storeId}.`;
  }

  const formTarget = el("newStoreId");
  if (formTarget) {
    formTarget.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => el("newStoreName")?.focus(), 300);
  }
}

function bindStoreEditButtons() {
  document.querySelectorAll("[data-edit-store]").forEach(button => {
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      editStore(button.dataset.editStore);
    };
  });
}

async function deleteStorePermanently(storeId, storeName) {
  if (currentRole !== "admin") return;

  const confirmed = confirm(`Sigur vrei să ștergi definitiv magazinul "${storeName}" (ID ${storeId})?`);
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "stores", String(storeId)));
    el("saveStoreStatus").textContent = `Magazinul ${storeName} a fost șters definitiv.`;
    await loadStores();
  } catch (error) {
    console.error("Ștergere magazin:", error);
    el("saveStoreStatus").textContent = "Magazinul nu a putut fi șters.";
  }
}

function bindStoreDeleteButtons() {
  document.querySelectorAll("[data-delete-store]").forEach(button => {
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      deleteStorePermanently(button.dataset.deleteStore, button.dataset.storeName || button.dataset.deleteStore);
    };
  });
}

function toggleStoreFormat() {
  const isCarrefour = el("newStoreCategory").value === "carrefour";
  el("newStoreFormat").classList.toggle("hidden", !isCarrefour);
}

async function saveStore() {
  const id = el("newStoreId").value.trim();
  const name = el("newStoreName").value.trim();
  const category = el("newStoreCategory").value;

  if (!id || !name) {
    el("saveStoreStatus").textContent = "Completează ID-ul și numele magazinului.";
    return;
  }

  const data = {
    name,
    category,
    active: el("newStoreActive").value === "true"
  };
  if (category === "carrefour") data.format = el("newStoreFormat").value;
  else data.format = "";

  await setDoc(doc(db, "stores", id), data, { merge: true });
  el("saveStoreStatus").textContent = "Magazinul a fost salvat. Lista rămâne restrânsă.";
  el("newStoreId").value = "";
  el("newStoreName").value = "";
  el("newStoreActive").value = "true";
  await loadStores();
  el("storeEditorPanel")?.classList.add("hidden");
}


function distanceKm(a,b,c,d){const R=6371,toRad=x=>x*Math.PI/180;const dLat=toRad(c-a),dLon=toRad(d-b);const q=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(q));}
async function recommendStoreByLocation(){
  const box=el("geoRecommendation"); if(!navigator.geolocation){box.textContent="Browserul nu suportă geolocalizarea.";box.className="geo-recommendation warn";return;}
  box.textContent="Se verifică locația..."; box.className="geo-recommendation";
  navigator.geolocation.getCurrentPosition(async pos=>{
    try{const snap=await getDocs(collection(db,"stores"));const candidates=snap.docs.map(d=>({id:d.id,...d.data()})).filter(s=>s.active!==false&&Number.isFinite(Number(s.latitude))&&Number.isFinite(Number(s.longitude))&&(currentCategory==="all"||normCategory(s.category||s.type)===currentCategory));
      if(!candidates.length){box.textContent="Magazinele nu au încă coordonate configurate. Adminul le poate completa din Coordonate magazine.";box.className="geo-recommendation warn";return;}
      const ranked=candidates.map(s=>({...s,distance:distanceKm(pos.coords.latitude,pos.coords.longitude,Number(s.latitude),Number(s.longitude))})).sort((a,b)=>a.distance-b.distance); const best=ranked[0];
      box.innerHTML=`Magazin recomandat: <b>${escapeHtml(best.name||best.id)}</b> · ID ${escapeHtml(best.id)} · ${best.distance.toFixed(1)} km`;box.className="geo-recommendation good";el("storeCode").value=best.id;
    }catch(err){box.textContent="Nu am putut calcula recomandarea.";box.className="geo-recommendation warn";}
  },()=>{box.textContent="Locația nu a fost permisă. Poți introduce ID-ul manual.";box.className="geo-recommendation warn";},{enableHighAccuracy:true,timeout:8000,maximumAge:300000});
}

async function loadUsers() {
  const list = el("usersList");
  if (!list) return;
  list.innerHTML = '<div class="empty">Se încarcă utilizatorii...</div>';
  try {
    const snap = await getDocs(collection(db, "users"));
    const users = snap.docs.map(d => ({ email: d.id, ...d.data() }))
      .sort((a,b) => String(a.displayName || a.email).localeCompare(String(b.displayName || b.email), "ro"));
    if (!users.length) {
      list.innerHTML = '<div class="empty">Nu există conturi configurate.</div>';
      return;
    }
    const roleLabel = { admin:"Admin", suport:"Utilizator intern", carrefour:"User Carrefour", franciza:"User Franciză" };
    const categoryLabel = { all:"Toate categoriile", suport:"Suport", carrefour:"Carrefour", franciza:"Franciză" };
    list.innerHTML = users.map(u => `
      <div class="store-row user-profile-row" data-user-email="${escapeHtml(u.email)}" style="cursor:pointer">
        <div><b>${escapeHtml(u.displayName || u.email)}</b><small>${escapeHtml(u.email)}</small></div>
        <div><b>${escapeHtml(roleLabel[u.role] || u.role || "-")}</b><small>${escapeHtml(categoryLabel[u.category] || u.category || "-")}</small></div>
        <div><small>${u.canAdd ? "✓ Adăugare materiale" : "— Fără adăugare"}</small><small>${u.canManage ? "✓ Editare/ștergere" : "— Fără editare/ștergere"}</small></div>
        <button type="button" class="secondary" data-edit-user="${escapeHtml(u.email)}">Editează</button>
      </div>`).join("");
    list.querySelectorAll("[data-edit-user]").forEach(btn => btn.addEventListener("click", e => {
      e.preventDefault(); e.stopPropagation();
      const u = users.find(x => x.email === btn.dataset.editUser); if (!u) return;
      if (el("userDisplayName")) el("userDisplayName").value = u.displayName || "";
      el("userEmail").value = u.email || "";
      el("userRole").value = u.role || "suport";
      el("userCategory").value = u.category || "all";
      el("userCanAdd").checked = !!u.canAdd;
      el("userCanManage").checked = !!u.canManage;
      el("userStatus").textContent = `Editezi drepturile pentru ${u.displayName || u.email}.`;
      el("userEmail").scrollIntoView({behavior:"smooth", block:"center"});
    }));
  } catch (error) {
    console.error("Încărcare utilizatori:", error);
    list.innerHTML = '<div class="empty">Utilizatorii nu au putut fi încărcați. Verifică drepturile Firestore.</div>';
  }
}

async function saveUserProfile(){if(!isPrimaryAdmin()){el("userStatus").textContent="Doar Adminul principal poate modifica drepturile.";return;}const email=el("userEmail").value.trim().toLowerCase();if(!email){el("userStatus").textContent="Completează emailul.";return;}await setDoc(doc(db,"users",email),{displayName:el("userDisplayName")?.value||"",role:el("userRole").value,category:el("userCategory").value,canAdd:el("userCanAdd").checked,canManage:el("userCanManage").checked,canManageUsers:false,updatedAt:serverTimestamp(),updatedBy:currentEmail},{merge:true});const savedName=el("userDisplayName")?.value||"";
el("userStatus").textContent="Drepturile au fost salvate.";
await loadUsers();}


async function recordShare(method) {
  if (!currentOpenMaterial) return;
  try {
    await addDoc(collection(db, "shares"), {
      materialId: currentOpenMaterial.id,
      title: currentOpenMaterial.title || "",
      type: currentOpenMaterial.type || "",
      method,
      email: currentEmail,
      storeId: currentStoreId,
      storeName: currentStoreName,
      storeFormat: currentStoreFormat,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.warn("Distribuirea nu a putut fi înregistrată.", error);
  }
}

async function shareWhatsApp() {
  if (!currentOpenMaterial) return;
  await recordShare("WhatsApp");
  const text = `${currentOpenMaterial.title || "Material"} - ${currentOpenMaterial.url || ""}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

async function shareEmail() {
  if (!currentOpenMaterial) return;
  await recordShare("E-mail");
  const subject = `SmartID Portal - ${currentOpenMaterial.title || "Material"}`;
  const body = `${currentOpenMaterial.title || "Material"}\n\n${currentOpenMaterial.url || ""}`;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyMaterialLink() {
  if (!currentOpenMaterial) return;
  await navigator.clipboard.writeText(currentOpenMaterial.url || "");
  await recordShare("Copiere link");
  alert("Linkul a fost copiat.");
}

async function openSharesHistory() {
  try {
    const snap = await getDocs(collection(db, "shares"));
    const shares = snap.docs.map(item => ({ id: item.id, ...item.data() })).reverse();
    el("sharesList").innerHTML = shares.length
      ? shares.map(item => `
          <div class="share-row">
            <b>${escapeHtml(item.title || "Material")}</b>
            <small>
              Distribuit de: ${escapeHtml(item.email || "Utilizator")}
              ${item.storeName ? ` · Magazin: ${escapeHtml(item.storeName)}` : ""}
              ${item.storeId ? ` · ID: ${escapeHtml(item.storeId)}` : ""}
              · Metodă: ${escapeHtml(item.method || "Necunoscută")}
            </small>
          </div>
        `).join("")
      : '<div class="empty">Nu există distribuiri înregistrate.</div>';
    el("sharesModal").classList.add("open");
  } catch (error) {
    console.warn(error);
  }
}

function openMenu() {
  el("sidebar").classList.add("open");
  el("menuOverlay").classList.add("open");
}
function closeMenu() {
  el("sidebar").classList.remove("open");
  el("menuOverlay").classList.remove("open");
}


async function cancelStoreSelection() {
  currentStoreId = "";
  currentStoreName = "";
  currentStoreFormat = "";
  el("storeCode").value = "";
  el("storeError").textContent = "";
  el("storeModal").classList.remove("open");
  await signOut(auth);
  el("loginPage").style.display = "flex";
  el("app").classList.add("hidden");
  el("email").focus();
}

function onIfPresent(id, eventName, handler) {
  const node = el(id);
  if (node) node.addEventListener(eventName, handler);
}

el("loginBtn").addEventListener("click", login);
el("password").addEventListener("keydown", event => { if (event.key === "Enter") login(); });
el("storeContinueBtn").addEventListener("click", continueWithStore);
el("storeLogoutBtn").addEventListener("click", cancelStoreSelection);
el("logoutBtn").addEventListener("click", async () => { await signOut(auth); location.reload(); });
el("menuBtn").addEventListener("click", openMenu);
el("shareWhatsAppBtn").addEventListener("click", shareWhatsApp);
el("shareEmailBtn").addEventListener("click", shareEmail);
el("copyLinkBtn").addEventListener("click", copyMaterialLink);

onIfPresent("closeSharesModalBtn", "click", () => el("sharesModal")?.classList.remove("open"));
el("closeMenuBtn").addEventListener("click", closeMenu);
el("menuOverlay").addEventListener("click", closeMenu);
el("closeViewerBtn").addEventListener("click", () => {
  el("viewer").classList.remove("open");
  el("viewerFrame").src = "about:blank";
  currentOpenMaterial = null;
  // Pentru utilizatorii portalului, revenirea dintr-un clip/procedură trebuie să ducă
  // întotdeauna în meniul principal de echipamente, nu într-o pagină intermediară goală.
  if (currentRole !== "admin") {
    renderEquipment();
    showPage("equipmentPage");
  }
});
el("saveMaterialBtn").addEventListener("click", saveMaterial);
el("cancelEditMaterialBtn").addEventListener("click", () => { resetMaterialForm(); el("materialStatus").textContent = ""; });
el("saveStoreBtn").addEventListener("click", saveStore);
el("closeStoreEditor")?.addEventListener("click",()=>el("storeEditorPanel")?.classList.add("hidden"));
el("newStoreCategory").addEventListener("change", toggleStoreFormat);
el("storeSearch").addEventListener("input", renderStores);
el("storeFilter").addEventListener("change", renderStores);
el("searchInput").addEventListener("input", () => {
  if (!el("materialsPage").classList.contains("hidden")) renderSelectedMaterials();
});

document.querySelectorAll(".side-btn").forEach(button => {
  button.addEventListener("click", async () => {
    const page = button.dataset.page;
    if (page === "dashboardPage") await loadDashboard();
    if (page === "equipmentPage") {
      if (currentRole === "admin" && !["carrefour","franciza","suport"].includes(currentCategory)) currentCategory = "carrefour";
      renderEquipment();
    }
    if (page === "manageMaterialsPage") await renderAdminMaterials();
    if (page === "usersPage") await loadUsers();
    if (page === "storesPage") await loadStores();
    showPage(page);
    closeMenu();
  });
});


document.querySelectorAll("[data-admin-category]").forEach(button => {
  button.addEventListener("click", () => {
    if (currentRole !== "admin") return;
    currentCategory = button.dataset.adminCategory;
    document.querySelectorAll("[data-admin-category]").forEach(b=>b.classList.toggle("active", b===button));
    renderEquipment();
    showPage("equipmentPage");
  });
});

document.querySelectorAll(".type-card").forEach(card => {
  card.addEventListener("click", () => {
    selectedMaterialType = card.dataset.materialType;
    el("selectedMaterialTypeTitle").textContent =
      selectedMaterialType === "videoclip" ? "Categorii videoclipuri" : "Categorii proceduri";
    renderEquipment();
    showPage("materialTypePage");
  });
});

document.querySelectorAll("[data-back]").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.back));
});

onIfPresent("detectLocationBtn", "click", recommendStoreByLocation);
onIfPresent("manageMaterialSearch", "input", renderAdminMaterials);
onIfPresent("manageMaterialType", "change", renderAdminMaterials);


onIfPresent("saveUserBtn", "click", saveUserProfile);




renderEquipmentChoices();
toggleStoreFormat();

if (el("closeDashboardDetailsBtn")) el("closeDashboardDetailsBtn").addEventListener("click",()=>el("dashboardDetailsModal").classList.remove("open"));
if (el("dashboardDetailsModal")) el("dashboardDetailsModal").addEventListener("click",e=>{if(e.target===el("dashboardDetailsModal")) el("dashboardDetailsModal").classList.remove("open");});





let authRestoreHandled = false;
onAuthStateChanged(auth, async user => {
  if (authRestoreHandled) return;
  authRestoreHandled = true;

  if (!user) {
    el("loginPage").style.display = "flex";
    el("app").classList.add("hidden");
    return;
  }

  try {
    await applyAuthenticatedUser(user, { restored: true });
  } catch (error) {
    console.warn("Sesiunea salvată nu a putut fi restaurată.", error);
    try { await signOut(auth); } catch {}
    el("loginPage").style.display = "flex";
    el("app").classList.add("hidden");
    el("loginError").textContent = error.message || "Autentifică-te din nou.";
  }
});

// Dashboard v7: cards are the controls; details/export live inside the popup.
function initCompactDashboardClicks(){
  document.querySelectorAll('.dashboard-pro-card').forEach(card=>{
    if(card.dataset.compactBound) return; card.dataset.compactBound='1';
    const detail=card.querySelector('[data-stat-details]');
    const type=card.classList.contains('card-logins')?'logins':card.classList.contains('card-stores')?'stores':card.classList.contains('card-videos')?'videos':card.classList.contains('card-procedures')?'procedures':'shares';
    card.setAttribute('role','button'); card.setAttribute('tabindex','0');
    const open=()=>{ const hidden=document.querySelector(`[data-stat-details="${type}"]`); if(hidden) hidden.click(); };
    card.addEventListener('click',open); card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
  });
  const team=document.getElementById('teamActivityCard');
  if(team && !team.dataset.compactBound){ team.dataset.compactBound='1';
    const openTeam=()=>{
      const acts=[...(dashboardDetailCache.teamActivity||[])].sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt));
      const label=a=>({material_added:'Adăugare',material_edited:'Editare',material_approved:'Aprobare',material_rejected:'Respingere',material_deleted:'Ștergere'}[a]||a||'Activitate');
      openDashboardDetails('Activitate echipă','Istoricul complet al activității colegilor.',acts.map(a=>({title:displayUser(a.email),detail:`${label(a.action)} · ${a.title||'Material'}${a.type?' · '+a.type:''}`,when:dashboardTimestamp(a.createdAt)})));
      setTimeout(()=>{
        const body=document.getElementById('dashboardDetailsBody'); if(!body||document.getElementById('teamModalExport')) return;
        const b=document.createElement('button'); b.id='teamModalExport'; b.className='secondary'; b.textContent='Export Excel'; b.style.marginBottom='12px';
        b.onclick=e=>{e.stopPropagation();document.getElementById('exportTeamExcel')?.click();}; body.prepend(b);
      },0);
    };
    team.addEventListener('click',openTeam); team.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openTeam();}});
  }
}
setInterval(initCompactDashboardClicks,700);

// Dashboard v8: detaliile se extind în pagină; Top 5 rămâne permanent vizibil.
function v8ActionLabel(action){return ({material_added:'Adăugare',material_edited:'Editare',material_approved:'Aprobare',material_rejected:'Respingere',material_deleted:'Ștergere'}[action]||action||'Activitate');}
function renderV8TopFive(){
  const list=document.getElementById('topFiveInlineList'); if(!list)return;
  const top=topVideoStats(dashboardDetailCache.views||[]);
  list.innerHTML=top.length?top.map((x,i)=>`<div class="top-five-item"><div class="top-five-rank">#${i+1}</div><div class="top-five-title" title="${escapeHtml(x.title)}">${escapeHtml(x.title)}</div><div class="top-five-meta">${x.count} vizualizări · ${x.users.size} utilizatori</div></div>`).join(''):'<div class="empty">Nu există încă vizualizări.</div>';
  const b=document.getElementById('exportTop5Inline'); if(b)b.onclick=e=>{e.stopPropagation();exportDashboardExcel('Top_5_videoclipuri_SmartID.xls',['Loc','Videoclip','Vizualizări','Utilizatori','Magazine','Ultima vizualizare'],top.map((x,i)=>[i+1,x.title,x.count,x.users.size,x.stores.size,dashboardTimestamp(x.last)]));};
}
function v8Rows(type){
 const {sessions,views,shares}=dashboardDetailCache;
 if(type==='logins')return [...sessions].sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt)).map(x=>({t:displayUser(x.email),d:x.storeName?`${x.storeName}${x.storeId?` · ID ${x.storeId}`:''}`:(x.role||''),w:dashboardTimestamp(x.createdAt)}));
 if(type==='stores'){const m=new Map();sessions.forEach(x=>{if(!x.storeId&&!x.storeName)return;const k=x.storeId||x.storeName,v=m.get(k)||{name:x.storeName||'Magazin',id:x.storeId||'',count:0,last:x.createdAt};v.count++;if(valueToMillis(x.createdAt)>valueToMillis(v.last))v.last=x.createdAt;m.set(k,v)});return [...m.values()].sort((a,b)=>b.count-a.count).map(x=>({t:`${x.name}${x.id?` · ID ${x.id}`:''}`,d:`${x.count} autentificări`,w:`Ultima: ${dashboardTimestamp(x.last)}`}));}
 if(type==='videos')return topVideoStats(views).map((x,i)=>({t:`${i+1}. ${x.title}`,d:`${x.count} vizualizări · ${x.users.size} utilizatori${x.stores.size?` · ${x.stores.size} magazine`:''}`,w:`Ultima: ${dashboardTimestamp(x.last)}`}));
 if(type==='procedures')return [...views].filter(x=>normType(x.type)==='procedura').sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt)).map(x=>({t:x.title||'Procedură',d:`${displayUser(x.email)}${x.storeName?` · ${x.storeName}`:''}`,w:dashboardTimestamp(x.createdAt)}));
 return [...shares].sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt)).map(x=>({t:x.title||'Material',d:`${displayUser(x.email)} · ${x.method||x.channel||'Distribuire'}`,w:dashboardTimestamp(x.createdAt)}));
}
function toggleV8Stat(type,card){
 const box=document.getElementById('statInlineDetails'), rows=v8Rows(type); if(!box)return;
 if(box.dataset.open===type&&!box.classList.contains('hidden')){box.classList.add('hidden');box.dataset.open='';return;}
 const titles={logins:'Autentificări',stores:'Magazine active',videos:'Top 10 videoclipuri',procedures:'Vizualizări proceduri',shares:'Distribuiri'};
 box.dataset.open=type;box.classList.remove('hidden');box.innerHTML=`<div class="stat-inline-head"><h2>${titles[type]}</h2><button class="inline-text-action" id="v8ExportStat">Export Excel ↗</button></div><div class="stat-inline-list">${rows.length?rows.map(r=>`<div class="stat-inline-row"><b>${escapeHtml(r.t)}</b><span>${escapeHtml(r.d)}</span><small>${escapeHtml(r.w)}</small></div>`).join(''):'<div class="empty">Nu există încă informații.</div>'}</div>`;
 document.getElementById('v8ExportStat').onclick=e=>{e.stopPropagation();exportDashboardExcel(`${titles[type].replace(/\s+/g,'_')}_SmartID.xls`,['Element','Detalii','Data/Ora'],rows.map(r=>[r.t,r.d,r.w]));};
 box.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderV8Team(){
 const box=document.getElementById('teamInlineDetails'); if(!box)return;
 const acts=[...(dashboardDetailCache.teamActivity||[])].sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt));
 const map=new Map();
 acts.forEach(a=>{const e=a.email||'Necunoscut';const v=map.get(e)||{items:[],last:null};v.items.push(a);if(!v.last||valueToMillis(a.createdAt)>valueToMillis(v.last))v.last=a.createdAt;map.set(e,v)});
 const rows=[...map.entries()].sort((a,b)=>valueToMillis(b[1].last)-valueToMillis(a[1].last));
 box.innerHTML=`<div class="team-summary-head apple-team-head"><div><b>Activitate colegi</b><span>Activitățile recente sunt vizibile direct. Apasă pe nume pentru istoricul complet.</span></div><button class="inline-text-action" id="v8TeamExport">Export Excel ↗</button></div><div class="apple-team-grid">${rows.length?rows.map(([e,v],i)=>`<article class="apple-team-person"><button type="button" class="apple-person-name" data-team-index="${i}">${escapeHtml(displayUser(e))}<span>⌄</span></button><div class="apple-recent-title">Recent</div><div class="apple-recent-list">${v.items.slice(0,3).map(a=>`<div class="apple-recent-row"><b>${escapeHtml(v8ActionLabel(a.action))}</b><span>${escapeHtml(a.title||'Material')}</span><small>${escapeHtml(dashboardTimestamp(a.createdAt))}</small></div>`).join('')||'<div class="empty">Fără activitate recentă.</div>'}</div><div class="team-user-history hidden" id="teamHistory${i}"></div></article>`).join(''):'<div class="empty">Nu există încă activitate.</div>'}</div>`;
 const entries=rows;
 box.querySelectorAll('.apple-person-name').forEach(btn=>btn.onclick=e=>{e.stopPropagation();const i=Number(btn.dataset.teamIndex),email=entries[i][0],hist=document.getElementById('teamHistory'+i),open=hist.classList.contains('hidden');if(open){const own=acts.filter(a=>(a.email||'Necunoscut')===email);hist.innerHTML=`<div class="apple-history-title">Istoric complet</div>`+own.map(a=>`<div class="team-history-row"><b>${escapeHtml(v8ActionLabel(a.action))}</b><span>${escapeHtml(a.title||'Material')}${a.type?' · '+escapeHtml(a.type):''}</span><small>${escapeHtml(dashboardTimestamp(a.createdAt))}</small></div>`).join('');hist.classList.remove('hidden');btn.classList.add('open')}else{hist.classList.add('hidden');btn.classList.remove('open')}});
 document.getElementById('v8TeamExport').onclick=e=>{e.stopPropagation();exportDashboardExcel('Activitate_echipa_SmartID.xls',['Utilizator','Acțiune','Material','Tip','Data/Ora'],acts.map(a=>[displayUser(a.email),v8ActionLabel(a.action),a.title||'',a.type||'',dashboardTimestamp(a.createdAt)]));};
}
function initV8Dashboard(){
 renderV8TopFive();
 document.querySelectorAll('.dashboard-pro-card').forEach(card=>{if(card.dataset.v8Bound)return;card.dataset.v8Bound='1';card.dataset.compactBound='1';const type=card.classList.contains('card-logins')?'logins':card.classList.contains('card-stores')?'stores':card.classList.contains('card-videos')?'videos':card.classList.contains('card-procedures')?'procedures':'shares';const handler=e=>{e.stopImmediatePropagation();e.preventDefault();toggleV8Stat(type,card)};card.addEventListener('click',handler,true);card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){handler(e)}},true)});
 const team=document.getElementById('teamActivityCard');if(team&&!team.dataset.v8Bound){team.dataset.v8Bound='1';team.dataset.compactBound='1';const h=e=>{e.stopImmediatePropagation();e.preventDefault();const box=document.getElementById('teamInlineDetails');const open=box.classList.contains('hidden');if(open){renderV8Team();box.classList.remove('hidden');team.classList.add('expanded')}else{box.classList.add('hidden');team.classList.remove('expanded')}};team.addEventListener('click',h,true);team.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){h(e)}},true)}
}
setInterval(initV8Dashboard,650);


// v9: collapsible equipment groups on Add Material
document.addEventListener('click', function(e){
  const btn=e.target.closest('.equipment-section-toggle');
  if(!btn) return;
  const section=btn.closest('.compact-equipment-section');
  const body=section && section.querySelector('.equipment-options');
  if(!body) return;
  const open=btn.getAttribute('aria-expanded')==='true';
  btn.setAttribute('aria-expanded', String(!open));
  body.classList.toggle('is-collapsed', open);
  const ch=btn.querySelector('.equipment-chevron');
  if(ch) ch.textContent=open?'⌄':'⌃';
});


// v14 verified dashboard team presentation: people first, recent activity visible, no chart.
function renderTeamCollapsedPreview(){
  const people=document.getElementById('teamPeoplePreview');
  const recent=document.getElementById('teamRecentPreview');
  if(!people||!recent) return;
  const acts=[...(dashboardDetailCache.teamActivity||[])].sort((x,y)=>valueToMillis(y.createdAt)-valueToMillis(x.createdAt));
  const configured=[...usersNameMap.values()].filter(Boolean).filter(n=>String(n).toLowerCase()!=='admin principal');
  const activeNames=acts.map(x=>displayUser(x.email)).filter(Boolean).filter(n=>n!=='Admin principal');
  const names=[...new Set([...configured,...TEAM_DISPLAY_NAMES,...activeNames])];
  people.innerHTML=names.slice(0,8).map(n=>`<span class="person-chip">${escapeHtml(n)}</span>`).join('');
  recent.innerHTML=acts.length?acts.slice(0,3).map(a=>`<div class="recent-preview-row"><b>${escapeHtml(displayUser(a.email))}</b><span>${escapeHtml(v8ActionLabel(a.action))} · ${escapeHtml(a.title||'Material')}</span><small>${escapeHtml(dashboardTimestamp(a.createdAt))}</small></div>`).join(''):'<div class="empty-inline">Nu există încă activitate recentă.</div>';
}

const _renderV8TeamOriginal=renderV8Team;
renderV8Team=function(){
 const box=document.getElementById('teamInlineDetails'); if(!box)return;
 const acts=[...(dashboardDetailCache.teamActivity||[])].sort((a,b)=>valueToMillis(b.createdAt)-valueToMillis(a.createdAt));
 const byEmail=new Map();
 [...usersNameMap.entries()].forEach(([email,name])=>{if(name && String(name).toLowerCase()!=='admin principal') byEmail.set(email,{name,items:[],last:null});});
 acts.forEach(a=>{const email=String(a.email||'').toLowerCase()||'necunoscut';const v=byEmail.get(email)||{name:displayUser(a.email),items:[],last:null};v.items.push(a);if(!v.last||valueToMillis(a.createdAt)>valueToMillis(v.last))v.last=a.createdAt;byEmail.set(email,v)});
 const rows=[...byEmail.entries()].sort((a,b)=>valueToMillis(b[1].last)-valueToMillis(a[1].last)||String(a[1].name).localeCompare(String(b[1].name),'ro'));
 box.innerHTML=`<div class="team-summary-head apple-team-head"><div><b>Activitate colegi</b><span>Vezi imediat ce a făcut fiecare coleg recent. Apasă pe nume pentru tot istoricul.</span></div><button class="inline-text-action" id="v8TeamExport">Export Excel ↗</button></div><div class="team-person-list">${rows.length?rows.map(([email,v],i)=>`<article class="team-person-row"><button type="button" class="apple-person-name" data-team-index="${i}">${escapeHtml(v.name||email)}<span>⌄</span></button><div class="team-person-recent">${v.items.length?v.items.slice(0,2).map(a=>`<div class="team-person-action"><span>${escapeHtml(v8ActionLabel(a.action))}</span><b>${escapeHtml(a.title||'Material')}</b><small>${escapeHtml(dashboardTimestamp(a.createdAt))}</small></div>`).join(''):'<span class="no-recent">Fără activitate recentă</span>'}</div><div class="team-user-history hidden" id="teamHistory${i}"></div></article>`).join(''):'<div class="empty">Nu există colegi configurați.</div>'}</div>`;
 box.querySelectorAll('.apple-person-name').forEach(btn=>btn.onclick=e=>{e.stopPropagation();const i=Number(btn.dataset.teamIndex),v=rows[i][1],hist=document.getElementById('teamHistory'+i),open=hist.classList.contains('hidden');if(open){hist.innerHTML=`<div class="apple-history-title">Istoric complet</div>`+(v.items.length?v.items.map(a=>`<div class="team-history-row"><b>${escapeHtml(v8ActionLabel(a.action))}</b><span>${escapeHtml(a.title||'Material')}${a.type?' · '+escapeHtml(a.type):''}</span><small>${escapeHtml(dashboardTimestamp(a.createdAt))}</small></div>`).join(''):'<div class="no-recent">Fără activitate înregistrată.</div>');hist.classList.remove('hidden');btn.classList.add('open')}else{hist.classList.add('hidden');btn.classList.remove('open')}});
 const exp=document.getElementById('v8TeamExport'); if(exp) exp.onclick=e=>{e.stopPropagation();exportDashboardExcel('Activitate_echipa_SmartID.xls',['Utilizator','Acțiune','Material','Tip','Data/Ora'],acts.map(a=>[displayUser(a.email),v8ActionLabel(a.action),a.title||'',a.type||'',dashboardTimestamp(a.createdAt)]));};
};
setInterval(renderTeamCollapsedPreview,900);
