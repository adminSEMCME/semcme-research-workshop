import { originalLibrarySections } from "../data/original-library.js";
import { config } from "./config.js";
import { getLibraryContent } from "./repositories.js";

const cache = {
  loadedAt: 0,
  value: null
};

const canonicalTopics = new Map([
  [
    "research from a residents perspective",
    {
      name: "Research from a Resident’s Perspective",
      date: "September 4, 2024",
      speaker: "Isabella Graham, MD"
    }
  ],
  [
    "designing a study",
    {
      name: "Designing a Study to Answer a Research Question and Test a Hypothesis",
      date: "September 11, 2024",
      speaker: "Carlos Rios-Bedoya, MPH, ScD – Corporate Director of the Division of Scholarly Inquiry at McLaren Health Care"
    }
  ],
  [
    "designing a study to answer a research question and test a hypothesis",
    {
      name: "Designing a Study to Answer a Research Question and Test a Hypothesis",
      date: "September 11, 2024",
      speaker: "Carlos Rios-Bedoya, MPH, ScD – Corporate Director of the Division of Scholarly Inquiry at McLaren Health Care"
    }
  ],
  [
    "overview of irb",
    {
      name: "Overview of IRB",
      date: "September 25, 2024",
      speaker: "Lee Bowen, MPA, CIP, CHRC – IRB Consultant at Ascension St. John Hospital"
    }
  ],
  [
    "timeline for a research study",
    {
      name: "Timeline for a Research Study: Design, IRB, Implementation, Presentation",
      date: "October 2, 2024",
      speaker: "Alexandra Halalau, MD, MSc, FACP – Research Director and APD, Internal Medicine at Corewell Royal Oak Hospital"
    }
  ],
  [
    "timeline for a research study design irb implementation presentation",
    {
      name: "Timeline for a Research Study: Design, IRB, Implementation, Presentation",
      date: "October 2, 2024",
      speaker: "Alexandra Halalau, MD, MSc, FACP – Research Director and APD, Internal Medicine at Corewell Royal Oak Hospital"
    }
  ],
  [
    "overview of statistics",
    {
      name: "Overview of Statistics",
      date: "October 9, 2024",
      speaker: "Karen Hagglund, MS – Medical Researcher, Ascension St. John Hospital"
    }
  ],
  [
    "protocol and literature review",
    {
      name: "Writing a Protocol and Critiquing the Medical Literature",
      date: "October 16, 2024",
      speaker: "David Sengstock, MD – Associate Director for Medical Education & Director of Resident Research, Corewell Health East"
    }
  ],
  [
    "writing a protocol and critiquing the medical literature",
    {
      name: "Writing a Protocol and Critiquing the Medical Literature",
      date: "October 16, 2024",
      speaker: "David Sengstock, MD – Associate Director for Medical Education & Director of Resident Research, Corewell Health East"
    }
  ],
  [
    "applications of ai in medicine",
    {
      name: "Applications of AI in Medicine",
      date: "October 23, 2024",
      speaker: "Ramin Homayouni, PhD – Director, Population Health Informatics and Professor, Foundation Medical Studies at OUWB School of Medicine"
    }
  ],
  [
    "evidence based medicine",
    {
      name: "Applying Evidence Based Medicine to Clinical Practice",
      date: "October 30, 2024",
      speaker: "Alexandra Halalau, MD, MSc, FACP – Research Director and APD, Internal Medicine at Corewell Royal Oak Hospital"
    }
  ],
  [
    "applying evidence based medicine to clinical practice",
    {
      name: "Applying Evidence Based Medicine to Clinical Practice",
      date: "October 30, 2024",
      speaker: "Alexandra Halalau, MD, MSc, FACP – Research Director and APD, Internal Medicine at Corewell Royal Oak Hospital"
    }
  ],
  [
    "writing a case report",
    {
      name: "Writing a Case Report",
      date: "November 6, 2024",
      speaker: "Camelia Arsene, MD, PhD, MHS – Medical Research Director for ProMedica Health System/ProMedica Physicians Group and Assistant Professor at the University of Toledo, College of Medicine and Life Sciences, Toledo, OH and Assistant Professor at Wayne State University University, School of Medicine, Detroit, MI"
    }
  ],
  [
    "writing an abstract",
    {
      name: "Writing an Abstract for a Scientific Meeting",
      date: "November 13, 2024",
      speaker: "Virginia Uhley, PhD – Associate Professor, OUWB School of Medicine"
    }
  ],
  [
    "writing an abstract for a scientific meeting",
    {
      name: "Writing an Abstract for a Scientific Meeting",
      date: "November 13, 2024",
      speaker: "Virginia Uhley, PhD – Associate Professor, OUWB School of Medicine"
    }
  ],
  [
    "oral presentation and av communications",
    {
      name: "Effective Oral Presentation and Use of AV Communications",
      date: "November 20, 2024",
      speaker: "Daniel Keyes, MD, MPH – Emergency Medicine, St. Mary Mercy Hospital, Livonia"
    }
  ],
  [
    "effective oral presentation and use of av communications",
    {
      name: "Effective Oral Presentation and Use of AV Communications",
      date: "November 20, 2024",
      speaker: "Daniel Keyes, MD, MPH – Emergency Medicine, St. Mary Mercy Hospital, Livonia"
    }
  ],
  [
    "poster design and presentation",
    {
      name: "Effective Poster Design and Presentation",
      date: "December 4, 2024",
      speaker: "Anupam Suneja, MD –APD, Internal Medicine, St. Joseph Mercy Ann Arbor"
    }
  ],
  [
    "effective poster design and presentation",
    {
      name: "Effective Poster Design and Presentation",
      date: "December 4, 2024",
      speaker: "Anupam Suneja, MD –APD, Internal Medicine, St. Joseph Mercy Ann Arbor"
    }
  ],
  [
    "preparing articles for publication",
    {
      name: "Preparing Articles for Publication",
      date: "December 11, 2024",
      speaker: "Jeffrey Flynn, PhD – Director of Scholarly Inquiry, Department of Medical Education, Ascension Providence Hospital and Adjunct Assistant Professor, MSU College of Human Medicine"
    }
  ]
]);

export function clearLibraryCache() {
  cache.loadedAt = 0;
  cache.value = null;
}

function videoEmbedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, "");
  if (host === "youtube.com" || host === "youtu.be") {
    const id = host === "youtu.be" ? parsed.pathname.slice(1) : parsed.searchParams.get("v");
    return id ? `https://www.youtube.com/embed/${id}` : null;
  }

  if (host === "vimeo.com") {
    const id = parsed.pathname.split("/").filter(Boolean).pop();
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }

  if (host.includes("zoom.us") && parsed.pathname.includes("/rec/")) return url;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(parsed.pathname)) return url;
  return null;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function canonicalKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function topicDetails(section) {
  const baseName = String(section.name || "");
  const details = canonicalTopics.get(canonicalKey(baseName));
  if (details) return details;

  const description = String(section.description || "");
  const beforeDash = description.split(/\s+-\s+live session/i)[0];
  return canonicalTopics.get(canonicalKey(beforeDash)) || {
    name: baseName,
    date: "",
    speaker: ""
  };
}

function cleanMaterialTitle(item) {
  const title = String(item.title || "").trim();
  const type = String(item.type || item.itemType || item.item_type || "").toLowerCase();
  if (type === "recording" || type === "video") return "Recording";
  if (type === "evaluation") return "Lecture Evaluation";
  if (/ - slides$/i.test(title)) return "Slides";
  for (const details of canonicalTopics.values()) {
    const prefix = `${details.name} - `;
    if (title.startsWith(prefix)) return title.slice(prefix.length);
  }
  return title;
}

function normalizeSections(sections, source) {
  const normalized = sections
    .filter((section) => canonicalKey(section.name) !== "course overview")
    .map((section) => {
      const details = topicDetails(section);
      return {
        name: details.name,
        id: section.slug || slugify(details.name),
        presenter: details.speaker,
        date: details.date,
        items: (section.items || []).map((item, index) => ({
          id: String(item.id || `${details.name}-${item.title}-${index}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
          title: cleanMaterialTitle(item),
          speaker: details.speaker || item.speaker || "",
          date: details.date || item.date || item.resource_date || "",
          url: item.url,
          type: item.type || item.itemType || item.item_type || "resource",
          embedUrl: videoEmbedUrl(item.url)
        }))
      };
    })
    .filter((section) => section.items.length);

  return {
    source,
    scrapedAt: new Date().toISOString(),
    sections: normalized,
    totalItems: normalized.reduce((total, section) => total + section.items.length, 0)
  };
}

function normalizeManagedSections(sections) {
  return normalizeSections(
    sections.map((section) => ({
      name: section.name,
      slug: section.slug,
      items: section.items.map((item) => ({
        id: item.id,
        title: item.title,
        speaker: item.speaker || "",
        date: item.resource_date || "",
        url: item.url,
        type: item.item_type || "resource"
      }))
    })),
    "admin"
  );
}

export function getOriginalLibrary() {
  return normalizeSections(originalLibrarySections, "original");
}

export async function getVirtualLibrary({ force = false } = {}) {
  const maxAgeMs = config.libraryCacheMinutes * 60 * 1000;
  if (!force && cache.value && Date.now() - cache.loadedAt < maxAgeMs) return cache.value;

  try {
    const managedSections = await getLibraryContent();
    if (managedSections.some((section) => section.items.length)) {
      cache.value = normalizeManagedSections(managedSections);
      if (cache.value.totalItems > 0) {
        cache.loadedAt = Date.now();
        return cache.value;
      }
    }
  } catch (error) {
    if (config.nodeEnv !== "production") {
      console.warn("Admin-managed library content unavailable:", error.message);
    }
  }

  cache.value = getOriginalLibrary();
  cache.loadedAt = Date.now();
  return cache.value;
}
