import { ENV } from "./env";
import { PDFDocument } from "pdf-lib";

type SupportedProvider = "yousign" | "docusign" | "docuseal" | "other";

export type EsignDispatchInput = {
  contractNumber: string;
  signerName: string;
  signerEmail: string;
  contractDownloadUrl: string;
  webhookUrl: string;
  isDayTrip?: boolean;
  templateIdOverride?: number | null;
  additionalDocuments?: Array<{ name: string; downloadUrl: string }>;
};

export type EsignDispatchResult = {
  provider: SupportedProvider;
  envelopeId: string;
  signUrl: string | null;
  sentAt: Date;
};

const provider = (process.env.ESIGN_PROVIDER || "other").toLowerCase() as SupportedProvider;

function getProvider(): SupportedProvider {
  if (provider === "yousign" || provider === "docusign" || provider === "docuseal") return provider;
  return "other";
}

function resolveDocusealSignUrl(payload: any, appUrl: string): string | null {
  const submitters = Array.isArray(payload?.submitters) ? payload.submitters : [];
  const firstSubmitter = submitters[0] || null;
  const directCandidates = [
    firstSubmitter?.url,
    firstSubmitter?.link,
    firstSubmitter?.sign_url,
    firstSubmitter?.signing_url,
    payload?.url,
    payload?.link,
    payload?.sign_url,
    payload?.signing_url,
    payload?.embedded_signing_url,
    payload?.data?.url,
    payload?.data?.sign_url,
    payload?.data?.embedded_signing_url,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  for (const candidate of directCandidates) {
    if (/^https?:\/\//i.test(candidate)) return candidate;
  }

  const slugCandidates = [
    firstSubmitter?.slug,
    payload?.slug,
    payload?.submission_slug,
    payload?.data?.slug,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  for (const slug of slugCandidates) {
    if (slug) return `${appUrl}/s/${slug}`;
  }

  return null;
}

function buildDocusealPdfFields(pageCount: number, signerRole: string, isDayTrip: boolean) {
  const safePages = Math.max(1, pageCount);
  const fields: any[] = [];
  const signatureArea = isDayTrip
    ? { page: safePages, x: 0.16, y: 0.52, w: 0.22, h: 0.04 }
    : { page: safePages, x: 0.33, y: 0.84, w: 0.18, h: 0.03 };
  const placeArea = isDayTrip
    ? { page: safePages, x: 0.07, y: 0.32, w: 0.16, h: 0.028 }
    : { page: safePages, x: 0.18, y: 0.79, w: 0.14, h: 0.026 };
  const dateArea = isDayTrip
    ? { page: safePages, x: 0.27, y: 0.32, w: 0.16, h: 0.028 }
    : { page: safePages, x: 0.52, y: 0.79, w: 0.14, h: 0.026 };
  const mentionArea = isDayTrip
    ? { page: safePages, x: 0.13, y: 0.44, w: 0.32, h: 0.03 }
    : { page: safePages, x: 0.10, y: 0.82, w: 0.22, h: 0.026 };

  fields.push({
    name: "Lieu",
    type: "text",
    role: signerRole,
    required: true,
    default_value: "La Ciotat",
    areas: [placeArea],
  });
  fields.push({
    name: "Date Signature",
    type: "date",
    role: signerRole,
    required: true,
    areas: [dateArea],
  });
  fields.push({
    name: "Lu et approuvé",
    type: "text",
    role: signerRole,
    required: true,
    default_value: "Lu et approuvé",
    areas: [mentionArea],
  });

  // Signature client sur la dernière page.
  fields.push({
    name: "Signature Client",
    type: "signature",
    role: signerRole,
    required: true,
    areas: [signatureArea],
  });

  // Paraphe en bas à droite de chaque page.
  for (let page = 1; page <= safePages; page += 1) {
    fields.push({
      name: `Paraphe ${page}`,
      type: "initials",
      role: signerRole,
      required: true,
      areas: [
        {
          page,
          x: 0.81,
          y: 0.94,
          w: 0.14,
          h: 0.03,
        },
      ],
    });
  }

  return fields;
}

async function dispatchYousign(input: EsignDispatchInput): Promise<EsignDispatchResult> {
  const apiKey = process.env.ESIGN_YOUSIGN_API_KEY;
  const baseUrl = (process.env.ESIGN_YOUSIGN_BASE_URL || "https://api-sandbox.yousign.app/v3").replace(/\/+$/, "");
  if (!apiKey) throw new Error("ESIGN_YOUSIGN_API_KEY manquant");

  const documents = [
    {
      name: `Contrat ${input.contractNumber}.pdf`,
      from_url: input.contractDownloadUrl,
    },
    ...(input.additionalDocuments || []).map((doc) => ({
      name: doc.name,
      from_url: doc.downloadUrl,
    })),
  ];

  // Minimal payload: if API contract differs, caller catches and falls back.
  const response = await fetch(`${baseUrl}/signature_requests`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Contrat ${input.contractNumber}`,
      delivery_mode: "none",
      timezone: "Europe/Paris",
      signers: [
        {
          info: {
            first_name: input.signerName.split(" ")[0] || input.signerName,
            last_name: input.signerName.split(" ").slice(1).join(" ") || "Client",
            email: input.signerEmail,
          },
          signature_level: "electronic_signature",
        },
      ],
      documents,
      metadata: {
        source: "sabine-sailing",
        contractNumber: input.contractNumber,
      },
      webhook_subscription: {
        callback_url: input.webhookUrl,
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => response.statusText);
    throw new Error(`Yousign error ${response.status}: ${details}`);
  }

  const payload: any = await response.json();
  return {
    provider: "yousign",
    envelopeId: String(payload.id || payload.signature_request_id || `yousign-${Date.now()}`),
    signUrl: payload.signers?.[0]?.signature_link || payload.signing_url || null,
    sentAt: new Date(),
  };
}

async function dispatchDocusign(input: EsignDispatchInput): Promise<EsignDispatchResult> {
  const accountId = process.env.ESIGN_DOCUSIGN_ACCOUNT_ID;
  const accessToken = process.env.ESIGN_DOCUSIGN_ACCESS_TOKEN;
  const basePath = (process.env.ESIGN_DOCUSIGN_BASE_PATH || "").replace(/\/+$/, "");
  if (!accountId || !accessToken || !basePath) {
    throw new Error("ESIGN_DOCUSIGN_ACCOUNT_ID / ESIGN_DOCUSIGN_ACCESS_TOKEN / ESIGN_DOCUSIGN_BASE_PATH manquants");
  }

  const documents = [
    {
      documentBase64: null,
      name: `Contrat ${input.contractNumber}.pdf`,
      fileExtension: "pdf",
      documentId: "1",
      remoteUrl: input.contractDownloadUrl,
    },
    ...(input.additionalDocuments || []).map((doc, index) => ({
      documentBase64: null,
      name: doc.name,
      fileExtension: "pdf",
      documentId: String(index + 2),
      remoteUrl: doc.downloadUrl,
    })),
  ];

  const response = await fetch(`${basePath}/v2.1/accounts/${accountId}/envelopes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      emailSubject: `Contrat ${input.contractNumber}`,
      status: "sent",
      documents,
      recipients: {
        signers: [
          {
            email: input.signerEmail,
            name: input.signerName,
            recipientId: "1",
            routingOrder: "1",
          },
        ],
      },
      eventNotification: {
        url: input.webhookUrl,
        includeEnvelopeVoidReason: "true",
        includeTimeZone: "true",
        loggingEnabled: "true",
        envelopeEvents: [{ envelopeEventStatusCode: "completed" }],
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => response.statusText);
    throw new Error(`DocuSign error ${response.status}: ${details}`);
  }

  const payload: any = await response.json();
  return {
    provider: "docusign",
    envelopeId: String(payload.envelopeId || `docusign-${Date.now()}`),
    signUrl: null,
    sentAt: new Date(),
  };
}

async function dispatchDocuseal(input: EsignDispatchInput): Promise<EsignDispatchResult> {
  const apiKey = String(process.env.ESIGN_DOCUSEAL_API_KEY || ENV.eSignDocusealApiKey || "").trim();
  const baseUrl = (process.env.ESIGN_DOCUSEAL_BASE_URL || ENV.eSignDocusealBaseUrl || "https://api.docuseal.com").replace(/\/+$/, "");
  const appUrl = String(process.env.ESIGN_DOCUSEAL_APP_URL || "https://docuseal.com").replace(/\/+$/, "");
  const role = (process.env.ESIGN_DOCUSEAL_ROLE || ENV.eSignDocusealRole || "").trim();
  const signerRole = role || "Signer";

  if (!apiKey) throw new Error("ESIGN_DOCUSEAL_API_KEY manquant");
  const contractResp = await fetch(input.contractDownloadUrl);
  if (!contractResp.ok) {
    throw new Error(`Impossible de charger le PDF contrat (${contractResp.status})`);
  }
  const contractBytes = Buffer.from(await contractResp.arrayBuffer());
  const contractBase64 = contractBytes.toString("base64");
  const contractPdf = await PDFDocument.load(contractBytes);
  const contractPageCount = contractPdf.getPageCount();
  const fields = buildDocusealPdfFields(contractPageCount, signerRole, Boolean(input.isDayTrip));

  const response = await fetch(`${baseUrl}/submissions/pdf`, {
    method: "POST",
    headers: {
      "X-Auth-Token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Contrat ${input.contractNumber}`,
      send_email: false,
      documents: [
        {
          name: `Contrat-${input.contractNumber}.pdf`,
          file: contractBase64,
          fields,
        },
      ],
      submitters: [
        {
          name: input.signerName,
          email: input.signerEmail,
          role: signerRole,
          values: {
            Lieu: "La Ciotat",
            "Lu et approuvé": "Lu et approuvé",
          },
        },
      ],
      metadata: {
        source: "sabine-sailing",
        contractNumber: input.contractNumber,
        contractDownloadUrl: input.contractDownloadUrl,
      },
      webhook_url: input.webhookUrl,
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => response.statusText);
    throw new Error(`DocuSeal error ${response.status}: ${details}`);
  }

  const payload: any = await response.json();
  const submissionId = String(payload?.id || payload?.submission_id || "").trim();
  let signUrl = resolveDocusealSignUrl(payload, appUrl);

  if (!signUrl && submissionId) {
    const lookupResponse = await fetch(`${baseUrl}/submissions/${encodeURIComponent(submissionId)}`, {
      method: "GET",
      headers: {
        "X-Auth-Token": apiKey,
        "Content-Type": "application/json",
      },
    }).catch(() => null);
    if (lookupResponse?.ok) {
      const lookupPayload: any = await lookupResponse.json().catch(() => null);
      signUrl = resolveDocusealSignUrl(lookupPayload, appUrl);
    }
  }

  if (!signUrl) {
    throw new Error("DocuSeal n'a pas retourne de lien de signature exploitable");
  }

  return {
    provider: "docuseal",
    envelopeId: submissionId || `docuseal-${Date.now()}`,
    signUrl,
    sentAt: new Date(),
  };
}

export async function dispatchEsign(input: EsignDispatchInput): Promise<EsignDispatchResult> {
  const p = getProvider();
  if (p === "yousign") return dispatchYousign(input);
  if (p === "docusign") return dispatchDocusign(input);
  if (p === "docuseal") return dispatchDocuseal(input);
  return {
    provider: "other",
    envelopeId: `manual-${Date.now()}`,
    signUrl: null,
    sentAt: new Date(),
  };
}

