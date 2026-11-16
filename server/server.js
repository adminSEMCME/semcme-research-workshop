import { resourceUrl, MAX_FILE_BYTES } from "./resource-files.js";
import { getWorkshopSettings, saveWorkshopSettings, validateWorkshopSettings, registrationNeedsRecheck } from "./workshop-settings.js";
import express from "express";
import cookieParser from "cookie-parser";
import { createHmac, timingSafeEqual } from "node:crypto";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { config } from "./config.js";
import { query } from "./db.js";
import {
  clearSessionCookie,
  requireSession,
  SESSION_COOKIE,
  setSessionCookie,
} from "./auth.js";
import {
  findVirtualLibraryRegistrationByEmail,
  ConstantContactError,
  listVirtualLibraryRegistrations,
  saveConstantContactTokens,
  validateRegistrationCampaign,
  withVirtualLibraryRegistrationDetails,
} from "./constantContact.js";
import { sendMagicLinkEmail } from "./mailer.js";
import {
  clearLibraryCache,
  getOriginalLibrary,
  getVirtualLibrary,
} from "./library.js";
import {
  consumeMagicLink,
  createMagicLink,
  createSession,
  deleteLibraryItem,
  deleteLibrarySection,
  findUserByEmail,
  getLibraryContent,
  listUsers,
  revokeSession,
  replaceLibraryContent,
  saveLibraryItem,
  saveLibrarySection,
  updateUserRegistrationStatus,
  upsertUserFromRegistration,
} from "./repositories.js";
import { isValidEmail, normalizeEmail, randomToken } from "./security.js";
import { rateLimit } from "./rateLimit.js";
import { applySchema } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const app = express();
const ADMIN_COOKIE = "rws_admin";
const CC_OAUTH_STATE_COOKIE = "rws_cc_oauth_state";
const CC_AUTHORIZE_URL = "https://authz.constantcontact.com/oauth2/default/v1/authorize";
const CC_TOKEN_URL = "https://authz.constantcontact.com/oauth2/default/v1/token";
const CC_OAUTH_SCOPES = ["account_read", "contact_data", "campaign_data", "offline_access"];

let schemaReady = false;
let schemaError = null;
async function ensureSchema() {
  if (schemaReady) return;
  if (!config.databaseUrl) {
    throw Object.assign(new Error("Research Workshop Series database URL is not configured."), { status: 503 });
  }
  try {
    await applySchema();
    schemaReady = true;
    schemaError = null;
  } catch (error) {
    schemaError = error;
    throw error;
  }
}

app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", 1);

app.use((request, response, next) => {
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "frame-src https://www.youtube.com https://player.vimeo.com https://*.zoom.us",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );

  if (config.nodeEnv === "production") {
    response.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }

  next();
});

// Authenticate before parsing the larger attachment payload.
app.use(cookieParser());
app.use(['/api/admin/library/items', '/api/admin/resource-uploads'], requireAdmin, express.json({ limit: '4300kb' }));
app.use(express.json({ limit: "100kb" }));
app.use(
  "/assets",
  express.static(path.join(rootDir, "assets"), { maxAge: "1h" }),
);
app.get("/styles.css", (request, response) =>
  response.sendFile(path.join(rootDir, "styles.css")),
);
app.get("/app.js", (request, response) =>
  response.sendFile(path.join(rootDir, "app.js")),
);
app.get("/admin.js", (request, response) =>
  response.sendFile(path.join(rootDir, "admin.js")),
);
app.get('/resource-download.js', (request, response) => response.sendFile(path.join(rootDir, 'resource-download.js')));
app.get("/admin.css", (request, response) =>
  response.sendFile(path.join(rootDir, "admin.css")),
);

function signAdminValue(value) {
  return createHmac("sha256", config.sessionSecret).update(value).digest("base64url");
}

function createAdminCookieValue() {
  const issuedAt = String(Date.now());
  return `${issuedAt}.${signAdminValue(issuedAt)}`;
}

function isAdminCookieValid(value) {
  const [issuedAt, signature] = String(value || "").split(".");
  if (!issuedAt || !signature) return false;
  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000) return false;
  const expected = signAdminValue(issuedAt);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function setAdminCookie(response) {
  response.cookie(ADMIN_COOKIE, createAdminCookieValue(), {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000,
    path: "/"
  });
}

function clearAdminCookie(response) {
  response.clearCookie(ADMIN_COOKIE, { path: "/" });
}

function clearOAuthStateCookie(response) {
  response.clearCookie(CC_OAUTH_STATE_COOKIE, { path: "/" });
}

function createSignedValue(value) {
  return `${value}.${signAdminValue(value)}`;
}

function verifySignedValue(value) {
  const [raw, signature] = String(value || "").split(".");
  if (!raw || !signature) return "";
  const expected = signAdminValue(raw);
  if (signature.length !== expected.length) return "";
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return "";
  return raw;
}

function requireAdmin(request, response, next) {
  if (isAdminCookieValid(request.cookies?.[ADMIN_COOKIE])) {
    next();
    return;
  }

  clearAdminCookie(response);
  response.status(401).json({ error: "Admin login required." });
}

function constantContactRedirectUri() {
  return `${config.appBaseUrl.replace(/\/$/, "")}/api/admin/constant-contact/callback`;
}

function constantContactAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: config.constantContact.clientId || "",
    response_type: "code",
    redirect_uri: constantContactRedirectUri(),
    scope: CC_OAUTH_SCOPES.join(" "),
    state,
  });
  return `${CC_AUTHORIZE_URL}?${params}`;
}

async function exchangeConstantContactAuthorizationCode(code) {
  if (!config.constantContact.clientId || !config.constantContact.clientSecret) {
    throw Object.assign(new Error("Constant Contact client credentials are not configured."), { status: 503 });
  }

  const credentials = Buffer.from(
    `${config.constantContact.clientId}:${config.constantContact.clientSecret}`,
  ).toString("base64");
  const response = await fetch(CC_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: constantContactRedirectUri(),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.error_description || data.error || "";
    throw new Error(`Constant Contact authorization failed ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  await saveConstantContactTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
  });
}

function constantContactFailureRedirect(reason = "unknown") {
  return `/admin?cc=failed&reason=${encodeURIComponent(String(reason).slice(0, 240))}`;
}

function isSameOriginRequest(request) {
  const origin = request.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(config.appBaseUrl).origin;
  } catch {
    return false;
  }
}

app.use((request, response, next) => {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(request.method) ||
    isSameOriginRequest(request)
  ) {
    next();
    return;
  }

  response.status(403).json({ error: "Forbidden." });
});

async function requireDatabase(request, response, next) {
  try {
    await ensureSchema();
    next();
  } catch (error) {
    next(error);
  }
}

function publicUser(user) {
  return {
    email: user.email,
    name: user.full_name || user.email,
  };
}

function publicRoleTitle(value) {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase().startsWith("summary for registration id:")) return "";
  return text;
}

function publicAdminUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.full_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email,
    memberInstitution: user.member_institution || user.organization || "",
    organization: user.organization || "",
    degree: user.degree || "",
    roleTitle: publicRoleTitle(user.role_title),
    specialty: user.specialty || "",
    registrationStatus: user.registration_status || "",
    registeredAt: user.registered_at || "",
    syncedAt: user.synced_at || "",
    lastLoginAt: user.last_login_at || "",
    createdAt: user.created_at || "",
  };
}

async function shouldRecheckRegistration(user) {
  return registrationNeedsRecheck(user, await getWorkshopSettings());
}

function userHasProfileDetails(user) {
  return Boolean(user?.member_institution && user?.degree && user?.role_title);
}

async function resolveRegisteredUser(email) {
  const existing = await findUserByEmail(email);
  if (existing && !(await shouldRecheckRegistration(existing))) return existing;

  const registration = await findVirtualLibraryRegistrationByEmail(email);
  if (!registration) {
    if (existing) await updateUserRegistrationStatus(email, 'NOT_REGISTERED');
    return null;
  }

  return upsertUserFromRegistration(await withVirtualLibraryRegistrationDetails(registration));
}

async function requireCurrentRegistration(request, response, next) {
  try {
    if (!(await shouldRecheckRegistration(request.user))) {
      next();
      return;
    }

    const registration = await findVirtualLibraryRegistrationByEmail(
      request.user.email,
    );
    if (!registration) {
      await updateUserRegistrationStatus(request.user.email, "NOT_REGISTERED");
      await revokeSession(request.cookies?.[SESSION_COOKIE]);
      clearSessionCookie(response);
      response.status(401).json({ error: "Authentication required." });
      return;
    }

    request.user = await upsertUserFromRegistration(
      await withVirtualLibraryRegistrationDetails(registration),
    );
    next();
  } catch (error) {
    next(error);
  }
}

app.get("/api/health", async (request, response) => {
  try {
    await ensureSchema();
    await query("SELECT 1");
    response.json({
      ok: true,
      service: "semcme-research-workshop",
      environment: config.nodeEnv,
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      service: "semcme-research-workshop",
      error: error.message,
    });
  }
});

app.get("/api/public-settings", requireDatabase, async (request, response, next) => {
  try { response.json({ registrationUrl: (await getWorkshopSettings()).registrationUrl }); }
  catch (error) { next(error); }
});

app.post(
  "/api/request-magic-link",
  requireDatabase,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, keyPrefix: "rws-magic-link" }),
  async (request, response, next) => {
    try {
      const email = normalizeEmail(request.body?.email);

      if (!isValidEmail(email)) {
        response.status(400).json({ error: "Enter a valid email address." });
        return;
      }

      const user = await resolveRegisteredUser(email);
      if (!user) {
        response.status(403).json({
          error: "This email is not registered for the SEMCME Research Workshop Series.",
          registrationUrl: (await getWorkshopSettings()).registrationUrl,
        });
        return;
      }

      const { token } = await createMagicLink(user.id, request);
      const magicLink = `${config.appBaseUrl.replace(/\/$/, "")}/?token=${encodeURIComponent(token)}`;
      await sendMagicLinkEmail({ to: user.email, magicLink });

      response.json({
        message:
          "Check your email for a secure Sign-In Link. Please allow up to 3 minutes for the Sign-In Link to arrive before requesting another one.",
      });
    } catch (error) {
      if (error instanceof ConstantContactError) {
        console.error("Research Workshop Series registration lookup failed:", error);
        response.status(error.status || 502).json({
          error:
            "Registration lookup is temporarily unavailable. Please try again in a few minutes.",
        });
        return;
      }

      next(error);
    }
  },
);

app.get("/api/verify-magic-link", requireDatabase, async (request, response, next) => {
  try {
    const token = String(request.query.token || "");
    const linkedUser = token ? await consumeMagicLink(token) : null;
    const user = linkedUser ? await resolveRegisteredUser(linkedUser.email) : null;

    if (!user) {
      response
        .status(401)
        .json({ error: "This Sign-In Link is invalid or expired." });
      return;
    }

    const session = await createSession(user.id);
    setSessionCookie(
      response,
      session.token,
      session.expiresAt,
      config.cookieSecure,
    );
    response.json(publicUser(user));
  } catch (error) {
    next(error);
  }
});

app.get(
  "/api/me",
  requireDatabase,
  requireSession,
  requireCurrentRegistration,
  (request, response) => {
    response.json(publicUser(request.user));
  },
);

app.post("/api/logout", requireDatabase, async (request, response, next) => {
  try {
    await revokeSession(request.cookies?.[SESSION_COOKIE]);
    clearSessionCookie(response);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get(["/admin", "/admin/"], (request, response) => {
  response.sendFile(path.join(rootDir, "admin.html"));
});

app.post("/api/admin/login", requireDatabase, (request, response) => {
  const username = String(request.body?.username || "");
  const password = String(request.body?.password || "");
  if (!config.adminUsername || !config.adminPassword) {
    response.status(503).json({ error: "Admin login is not configured." });
    return;
  }
  if (username !== config.adminUsername || password !== config.adminPassword) {
    response.status(401).json({ error: "Invalid admin username or password." });
    return;
  }
  setAdminCookie(response);
  response.json({ ok: true });
});

app.post("/api/admin/logout", requireDatabase, (request, response) => {
  clearAdminCookie(response);
  response.json({ ok: true });
});

app.get("/api/admin/me", requireDatabase, requireAdmin, (request, response) => {
  response.json({ ok: true });
});

app.get("/api/admin/constant-contact/connect", requireDatabase, (request, response) => {
  if (!isAdminCookieValid(request.cookies?.[ADMIN_COOKIE])) {
    response.redirect("/admin");
    return;
  }
  if (!config.constantContact.clientId || !config.constantContact.clientSecret) {
    response.status(503).json({ error: "Constant Contact client credentials are not configured." });
    return;
  }

  const state = randomToken(16);
  response.cookie(CC_OAUTH_STATE_COOKIE, createSignedValue(state), {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
  response.redirect(constantContactAuthorizationUrl(state));
});

app.get("/api/admin/constant-contact/callback", requireDatabase, async (request, response) => {
  const expectedState = verifySignedValue(request.cookies?.[CC_OAUTH_STATE_COOKIE]);
  const returnedState = String(request.query?.state || "");
  const code = String(request.query?.code || "");
  clearOAuthStateCookie(response);

  if (!expectedState || returnedState !== expectedState || !code) {
    response.redirect(constantContactFailureRedirect("The Constant Contact response could not be verified. Please start the reconnect again from this admin page."));
    return;
  }

  try {
    await exchangeConstantContactAuthorizationCode(code);
    response.redirect("/admin?cc=connected");
  } catch (error) {
    console.error("Constant Contact authorization failed:", error);
    response.redirect(constantContactFailureRedirect(error.message || "Constant Contact authorization failed."));
  }
});

function publicAdminLibrary(sections) {
  return {
    sections: sections.map((section) => ({
      id: section.id,
      name: section.name,
      slug: section.slug,
      description: section.description || "",
      displayOrder: section.display_order,
      isVisible: section.is_visible,
      items: section.items.map((item) => ({
        id: item.id,
        sectionId: item.section_id,
        title: item.title,
        speaker: item.speaker || "",
        date: item.resource_date || "",
        url: resourceUrl(item),
        fileName: item.file_name || "",
        itemType: item.item_type,
        displayOrder: item.display_order,
        isVisible: item.is_visible
      }))
    }))
  };
}

app.get("/api/admin/library", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    response.json(publicAdminLibrary(await getLibraryContent({ includeHidden: true })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/registration-settings', requireDatabase, requireAdmin, async (request, response, next) => {
  try { response.json(await getWorkshopSettings()); } catch (error) { next(error); }
});

app.put('/api/admin/registration-settings', requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const settings = await validateRegistrationCampaign(validateWorkshopSettings(request.body || {}));
    response.json(await saveWorkshopSettings(settings));
  } catch (error) { next(error); }
});

app.get("/api/admin/users", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const users = await listUsers();
    response.json({ users: users.map(publicAdminUser) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/users/sync", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const registrations = await listVirtualLibraryRegistrations();
    const users = [];
    let institutionsFound = 0;
    let degreesFound = 0;
    let rolesFound = 0;
    for (const registration of registrations) {
      const detailedRegistration = await withVirtualLibraryRegistrationDetails(registration);
      users.push(await upsertUserFromRegistration(detailedRegistration));
      if (detailedRegistration.memberInstitution) institutionsFound += 1;
      if (detailedRegistration.degree) degreesFound += 1;
      if (detailedRegistration.roleTitle) rolesFound += 1;
    }
    response.json({
      synced: users.length,
      registrationsFound: registrations.recordsFound || registrations.length,
      institutionsFound,
      degreesFound,
      rolesFound,
      tracksChecked: registrations.tracksChecked || 1,
      users: (await listUsers()).map(publicAdminUser),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/library/import-source", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const current = getOriginalLibrary();
    await replaceLibraryContent(current);
    clearLibraryCache();
    response.json({
      ...publicAdminLibrary(await getLibraryContent({ includeHidden: true })),
      source: "original",
      importedItems: current.totalItems,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/library/sections", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const section = await saveLibrarySection(request.body || {});
    clearLibraryCache();
    response.json({ section });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/library/sections/:id", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const section = await saveLibrarySection({ ...(request.body || {}), id: request.params.id });
    clearLibraryCache();
    response.json({ section });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/library/sections/:id", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    await deleteLibrarySection(request.params.id);
    clearLibraryCache();
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/resource-uploads', requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const { name, totalBytes } = request.body || {};
    if (!Number.isInteger(totalBytes) || totalBytes < 1 || totalBytes > MAX_FILE_BYTES) return response.status(400).json({ error: 'Choose a nonempty file no larger than 20 MB.' });
    if (typeof name !== 'string' || !/\.(pdf|docx|pptx|xlsx|txt|png|jpe?g)$/i.test(name)) return response.status(400).json({ error: 'Choose a supported document or image file.' });
    await query("DELETE FROM rws_resource_uploads WHERE created_at <= CURRENT_TIMESTAMP - INTERVAL '1 day'");
    const id = randomToken(24);
    await query('INSERT INTO rws_resource_uploads (id,file_name,total_bytes) VALUES ($1,$2,$3)', [id, name.slice(0, 180), totalBytes]);
    response.json({ id });
  } catch (error) { next(error); }
});

app.put('/api/admin/resource-uploads/:id', requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const { offset, data } = request.body || {};
    if (!Number.isInteger(offset) || offset < 0 || typeof data !== 'string' || !data.length || data.length > Math.ceil(2 * 1024 * 1024 / 3) * 4 || /[^A-Za-z0-9+/=]/.test(data)) return response.status(400).json({ error: 'Invalid upload chunk. Please select the file and try again.' });
    const bytes = Buffer.from(data, 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024 || bytes.toString('base64') !== data) return response.status(400).json({ error: 'Invalid upload chunk.' });
    const result = await query(`UPDATE rws_resource_uploads SET file_data=file_data || $2::bytea
      WHERE id=$1 AND octet_length(file_data)=$3 AND octet_length(file_data)+$4 <= total_bytes
      AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 day' RETURNING octet_length(file_data) AS received`, [request.params.id, bytes, offset, bytes.length]);
    if (!result.rows.length) return response.status(409).json({ error: 'Upload expired or arrived out of order. Please save the resource again.' });
    response.json(result.rows[0]);
  } catch (error) { next(error); }
});

app.delete('/api/admin/resource-uploads/:id', requireDatabase, requireAdmin, async (request, response, next) => {
  try { await query('DELETE FROM rws_resource_uploads WHERE id=$1', [request.params.id]); response.json({ ok: true }); }
  catch (error) { next(error); }
});

app.post("/api/admin/library/items", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const item = await saveLibraryItem(request.body || {});
    clearLibraryCache();
    response.json({ item });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/library/items/:id", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    const item = await saveLibraryItem({ ...(request.body || {}), id: request.params.id });
    clearLibraryCache();
    response.json({ item });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/library/items/:id", requireDatabase, requireAdmin, async (request, response, next) => {
  try {
    await deleteLibraryItem(request.params.id);
    clearLibraryCache();
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/resources/:id/file', requireDatabase, async (request, response, next) => {
  try {
    if (isAdminCookieValid(request.cookies?.[ADMIN_COOKIE])) return next();
    await requireSession(request, response, async error => {
      if (error) return next(error);
      await requireCurrentRegistration(request, response, next);
    });
  } catch (error) { next(error); }
}, async (request, response, next) => {
  try {
    if (!/^[1-9]\d*$/.test(request.params.id)) return response.status(404).json({ error: 'Resource not found.' });
    const admin = isAdminCookieValid(request.cookies?.[ADMIN_COOKIE]);
    const { rows } = await query(`SELECT i.file_name,i.file_type,octet_length(i.file_data) AS size,i.updated_at::text AS version FROM rws_library_items i
      JOIN rws_library_sections s ON s.id=i.section_id
      WHERE i.id=$1 AND i.file_data IS NOT NULL AND ($2 OR (i.is_visible AND s.is_visible))`, [request.params.id, admin]);
    const file = rows[0];
    if (!file) return response.status(404).json({ error: 'Resource not found.' });
    response.setHeader('Cache-Control', 'private, no-store');
    if (request.query.info === '1') return response.json({ name: file.file_name, type: file.file_type, size: file.size, version: file.version });
    const chunked = request.query.part !== undefined;
    if (!chunked && file.size > 3 * 1024 * 1024) return response.sendFile(path.join(rootDir, 'resource-download.html'));
    const part = chunked ? Number(request.query.part) : 0;
    if (!Number.isInteger(part) || part < 0 || part * 2 * 1024 * 1024 >= file.size) return response.status(400).json({ error: 'Invalid download part.' });
    if (chunked && request.query.version !== file.version) return response.status(409).json({ error: 'This file changed. Please restart the download.' });
    const start = chunked ? part * 2 * 1024 * 1024 + 1 : 1;
    const length = chunked ? 2 * 1024 * 1024 : file.size;
    const result = await query('SELECT substring(file_data from $2::int for $3::int) AS file_data FROM rws_library_items WHERE id=$1 AND updated_at::text=$4', [request.params.id, start, length, file.version]);
    if (!result.rows.length) return response.status(409).json({ error: 'This file changed. Please restart the download.' });
    response.setHeader('Content-Type', file.file_type);
    response.setHeader('Content-Disposition', `attachment; filename="resource.${file.file_name.split('.').pop().replace(/[^a-zA-Z0-9]/g, '')}"; filename*=UTF-8''${encodeURIComponent(file.file_name).replace(/'/g, '%27')}`);
    response.send(result.rows[0].file_data);
  } catch (error) { next(error); }
});

app.get(
  "/api/library",
  requireDatabase,
  requireSession,
  requireCurrentRegistration,
  async (request, response, next) => {
    try {
      const force =
        request.query.refresh === "true" && config.nodeEnv !== "production";
      response.json(await getVirtualLibrary({ force }));
    } catch (error) {
      next(error);
    }
  },
);

app.get("*", (request, response) => {
  response.sendFile(path.join(rootDir, "index.html"));
});

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error.status && error.status < 500) {
    response.status(error.status).json({ error: error.message });
    return;
  }

  const requestId = randomToken(6);
  console.error(`Research Workshop Series error ${requestId}:`, error);
  response.status(500).json({ error: "Something went wrong.", requestId });
});

function startServer() {
  return app.listen(config.port, () => {
    console.log(`SEMCME Research Workshop Series listening on ${config.appBaseUrl}`);
  });
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  startServer();
}

export default app;
export { startServer };
