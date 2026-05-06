import { ENV } from "./env";

type SupportedProvider = "yousign" | "docusign" | "docuseal" | "other";

export type EsignDispatchInput = {
  contractNumber: string;
  signerName: string;
  signerEmail: string;
  contractDownloadUrl: string;
  webhookUrl: string;
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
  const apiKey = process.env.ESIGN_DOCUSEAL_API_KEY || ENV.eSignDocusealApiKey;
  const baseUrl = (process.env.ESIGN_DOCUSEAL_BASE_URL || ENV.eSignDocusealBaseUrl || "https://api.docuseal.com").replace(/\/+$/, "");
  const appUrl = String(process.env.ESIGN_DOCUSEAL_APP_URL || "https://docuseal.com").replace(/\/+$/, "");
  const role = (process.env.ESIGN_DOCUSEAL_ROLE || ENV.eSignDocusealRole || "").trim();

  if (!apiKey) throw new Error("ESIGN_DOCUSEAL_API_KEY manquant");
  const contractResp = await fetch(input.contractDownloadUrl);
  if (!contractResp.ok) {
    throw new Error(`Impossible de charger le PDF contrat (${contractResp.status})`);
  }
  const contractBytes = Buffer.from(await contractResp.arrayBuffer());
  const contractBase64 = contractBytes.toString("base64");

  const response = await fetch(`${baseUrl}/submissions/pdf`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Auth-Token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `Contrat ${input.contractNumber}`,
      documents: [
        {
          name: `Contrat-${input.contractNumber}.pdf`,
          file: contractBase64,
        },
      ],
      submitters: [
        {
          name: input.signerName,
          email: input.signerEmail,
          ...(role ? { role } : {}),
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
  const firstSubmitter = Array.isArray(payload?.submitters) ? payload.submitters[0] : null;
  const directSignUrl = String(firstSubmitter?.url || firstSubmitter?.link || payload?.url || payload?.sign_url || "").trim();
  const slug = String(firstSubmitter?.slug || "").trim();
  const fallbackSlugUrl = slug ? `${appUrl}/s/${slug}` : null;
  return {
    provider: "docuseal",
    envelopeId: String(payload?.id || payload?.submission_id || `docuseal-${Date.now()}`),
    signUrl:
      (/^https?:\/\//i.test(directSignUrl) ? directSignUrl : null) ||
      (/^https?:\/\//i.test(String(payload?.embedded_signing_url || "")) ? String(payload.embedded_signing_url) : null) ||
      fallbackSlugUrl,
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

