const state = {
  user: null,
  library: null,
  search: "",
  selectedSections: new Set(),
};

const elements = {
  loginView: document.querySelector("#loginView"),
  portalView: document.querySelector("#portalView"),
  loginForm: document.querySelector("#loginForm"),
  email: document.querySelector("#email"),
  loginError: document.querySelector("#loginError"),
  loginSuccess: document.querySelector("#loginSuccess"),
  previewButton: document.querySelector("#previewButton"),
  registerLink: document.querySelector("#registerLink"),
  signOutButton: document.querySelector("#signOutButton"),
  publicLinks: document.querySelectorAll(".public-nav-link"),
  welcomeText: document.querySelector("#welcomeText"),
  resourceCount: document.querySelector("#resourceCount"),
  searchInput: document.querySelector("#searchInput"),
  sectionFilterButton: document.querySelector("#sectionFilterButton"),
  sectionFilterMenu: document.querySelector("#sectionFilterMenu"),
  clearFiltersButton: document.querySelector("#clearFiltersButton"),
  sectionList: document.querySelector("#sectionList"),
  emptyState: document.querySelector("#emptyState"),
  sourceNote: document.querySelector("#sourceNote"),
  loadingState: document.querySelector("#loadingState"),
};

function setAuthView(isAuthenticated) {
  elements.loginView.hidden = isAuthenticated;
  elements.portalView.hidden = !isAuthenticated;
  elements.signOutButton.hidden = !isAuthenticated;
  elements.publicLinks.forEach((link) => {
    link.hidden = isAuthenticated;
  });
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Request failed.");
    error.data = data;
    throw error;
  }
  return data;
}

function cleanUrlToken() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("token")) return;
  url.searchParams.delete("token");
  window.history.replaceState(
    {},
    document.title,
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function sectionNames() {
  return (state.library?.sections || []).map((section) => section.name);
}

function renderSectionFilter() {
  elements.sectionFilterMenu.innerHTML = "";

  const allLabel = document.createElement("label");
  allLabel.className = "section-option";
  allLabel.innerHTML = `<input type="checkbox" value="__all__" ${state.selectedSections.size === 0 ? "checked" : ""}> All sections`;
  elements.sectionFilterMenu.append(allLabel);

  sectionNames().forEach((name) => {
    const label = document.createElement("label");
    label.className = "section-option";
    const checked = state.selectedSections.has(name) ? "checked" : "";
    label.innerHTML = `<input type="checkbox" value="${escapeAttribute(name)}" ${checked}> ${escapeHtml(name)}`;
    elements.sectionFilterMenu.append(label);
  });

  updateFilterButtonLabel();
}

function updateFilterButtonLabel() {
  const count = state.selectedSections.size;
  elements.sectionFilterButton.textContent = count
    ? `Filter by section (${count})`
    : "Filter by section (All)";
}

function setLoading(isLoading) {
  elements.loadingState.hidden = !isLoading;
  elements.sectionList.hidden = isLoading;
}

function matchesSearch(item, sectionName) {
  const value = state.search.trim().toLowerCase();
  if (!value) return true;
  return [sectionName, item.title, item.speaker, item.date]
    .join(" ")
    .toLowerCase()
    .includes(value);
}

function filteredSections() {
  return (state.library?.sections || [])
    .filter(
      (section) =>
        state.selectedSections.size === 0 ||
        state.selectedSections.has(section.name),
    )
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => matchesSearch(item, section.name)),
    }))
    .filter((section) => section.items.length);
}

function renderLibrary() {
  const sections = filteredSections();
  elements.sectionList.innerHTML = "";
  elements.emptyState.hidden = true;

  sections.forEach((section) => {
    const article = document.createElement("article");
    article.className = "workshop-section";
    article.id = section.id;
    const recording = section.items.find(isRecording);
    const materials = section.items.filter((item) => item !== recording);
    article.innerHTML = `
      <div class="section-heading">
        <div>
          <h3>${escapeHtml(section.name)}</h3>
          ${section.description ? `<p class="section-description">${escapeHtml(section.description)}</p>` : ""}
        </div>
        <p>${section.items.length} material${section.items.length === 1 ? "" : "s"}</p>
      </div>
      <div class="workshop-content">
        ${recording ? renderRecordingPreview(recording) : ""}
        <div class="material-list"></div>
      </div>
    `;

    const list = article.querySelector(".material-list");
    materials.forEach((item) => {
      list.append(renderMaterialLink(item));
    });
    if (!materials.length && recording) {
      list.remove();
    }

    elements.sectionList.append(article);
  });

  const total = sections.reduce(
    (sum, section) => sum + section.items.length,
    0,
  );
  elements.emptyState.hidden = total > 0;
  if (total === 0) {
    elements.emptyState.hidden = false;
  }
}

function isRecording(item) {
  return item.embedUrl || ["recording", "video"].includes(String(item.type || "").toLowerCase());
}

function youtubeThumbnail(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const id = host === "youtu.be" ? parsed.pathname.slice(1) : parsed.searchParams.get("v");
    return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : "";
  } catch {
    return "";
  }
}

function renderRecordingPreview(item) {
  const thumbnail = youtubeThumbnail(item.url);
  const media = thumbnail
    ? `<img src="${escapeAttribute(thumbnail)}" alt="" loading="lazy">`
    : `<div class="resource-placeholder" aria-hidden="true">RWS</div>`;

  return `
    <a class="recording-card" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener">
      <span class="recording-media">
        ${media}
        <span class="play-badge" aria-hidden="true"></span>
      </span>
      <span class="recording-body">
        <span class="material-type">${escapeHtml(materialTypeLabel(item))}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml([item.speaker, item.date].filter(Boolean).join(" - "))}</small>
      </span>
    </a>
  `;
}

function renderMaterialLink(item) {
  const link = document.createElement("a");
  link.className = `material-link material-${escapeAttribute(String(item.type || "resource").toLowerCase())}`;
  link.href = item.url;
  link.target = "_blank";
  link.rel = "noopener";
  link.innerHTML = `
    <span class="material-type">${escapeHtml(materialTypeLabel(item))}</span>
    <span class="material-text">
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml([item.speaker, item.date].filter(Boolean).join(" - "))}</small>
    </span>
    <span class="material-arrow" aria-hidden="true">→</span>
  `;
  return link;
}

function materialTypeLabel(item) {
  const type = String(item.type || "resource").toLowerCase();
  const labels = {
    recording: "Recording",
    video: "Recording",
    slides: "Slides",
    handout: "Handout",
    evaluation: "Evaluation",
    pdf: "PDF",
    link: "Link",
    resource: "Resource",
  };
  return labels[type] || "Resource";
}

function updateLibrarySummary() {
  const total = state.library?.totalItems || 0;
  elements.resourceCount.textContent = String(total);

  const searchActive = state.search.trim() || state.selectedSections.size;
  elements.sourceNote.textContent = state.library?.warning || "";
  elements.sourceNote.hidden = !state.library?.warning && !searchActive;
  if (searchActive && !state.library?.warning) {
    elements.sourceNote.textContent = "Filters are active.";
  }
  elements.sourceNote.classList.toggle(
    "warning",
    Boolean(state.library?.warning),
  );
}

async function loadLibrary({ preview = false } = {}) {
  setLoading(true);
  try {
    state.library = await requestJson(
      preview ? "/api/library-preview" : "/api/library",
    );
    renderSectionFilter();
    updateLibrarySummary();
    renderLibrary();
  } finally {
    setLoading(false);
  }
}

async function showPortal(user, options = {}) {
  state.user = user;
  elements.welcomeText.textContent = `Welcome back, ${user.name || user.email}.`;
  await loadLibrary(options);
  setAuthView(true);
}

async function bootstrap() {
  const settings = await requestJson("/api/public-settings").catch(() => ({}));
  if (settings.registrationUrl)
    elements.registerLink.href = settings.registrationUrl;

  const token = new URLSearchParams(window.location.search).get("token");
  if (token) {
    try {
      const user = await requestJson(
        `/api/verify-magic-link?token=${encodeURIComponent(token)}`,
      );
      cleanUrlToken();
      await showPortal(user);
      return;
    } catch (error) {
      cleanUrlToken();
      elements.loginError.textContent = error.message;
    }
  }

  try {
    const user = await requestJson("/api/me");
    await showPortal(user);
  } catch {
    setAuthView(false);
  }
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.loginError.textContent = "";
  elements.loginSuccess.textContent = "";
  const button = elements.loginForm.querySelector("button");
  button.disabled = true;

  try {
    const data = await requestJson("/api/request-magic-link", {
      method: "POST",
      body: JSON.stringify({ email: elements.email.value }),
    });
    elements.loginSuccess.textContent = data.message;
  } catch (error) {
    if (error.data?.registrationUrl) {
      elements.registerLink.href = error.data.registrationUrl;
      elements.loginError.innerHTML = `${escapeHtml(error.message)} <a href="${escapeAttribute(error.data.registrationUrl)}" target="_blank" rel="noopener">Register here</a>, then sign in again.`;
    } else {
      elements.loginError.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
});

elements.previewButton.addEventListener("click", async () => {
  elements.loginError.textContent = "";
  elements.loginSuccess.textContent = "Loading preview materials...";
  elements.previewButton.disabled = true;

  try {
    await showPortal(
      { name: "Preview User", email: "preview@semcme.org" },
      { preview: true },
    );
    elements.loginSuccess.textContent = "";
  } catch (error) {
    elements.loginError.textContent = error.message;
    elements.loginSuccess.textContent = "";
  } finally {
    elements.previewButton.disabled = false;
  }
});

elements.signOutButton.addEventListener("click", async () => {
  await requestJson("/api/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  state.library = null;
  setAuthView(false);
});

elements.searchInput.addEventListener("input", () => {
  state.search = elements.searchInput.value;
  renderLibrary();
  updateLibrarySummary();
});

elements.sectionFilterButton.addEventListener("click", () => {
  const isOpen = !elements.sectionFilterMenu.hidden;
  elements.sectionFilterMenu.hidden = isOpen;
  elements.sectionFilterButton.setAttribute("aria-expanded", String(!isOpen));
});

elements.sectionFilterMenu.addEventListener("change", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;

  if (input.value === "__all__") {
    state.selectedSections.clear();
  } else if (input.checked) {
    state.selectedSections.add(input.value);
  } else {
    state.selectedSections.delete(input.value);
  }

  renderSectionFilter();
  renderLibrary();
  updateLibrarySummary();
});

elements.clearFiltersButton.addEventListener("click", () => {
  state.search = "";
  state.selectedSections.clear();
  elements.searchInput.value = "";
  renderSectionFilter();
  renderLibrary();
  updateLibrarySummary();
});

document.addEventListener("click", (event) => {
  if (elements.sectionFilterMenu.hidden) return;
  if (
    elements.sectionFilterMenu.contains(event.target) ||
    elements.sectionFilterButton.contains(event.target)
  )
    return;
  elements.sectionFilterMenu.hidden = true;
  elements.sectionFilterButton.setAttribute("aria-expanded", "false");
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

bootstrap();
