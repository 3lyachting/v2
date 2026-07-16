import { rgb } from "pdf-lib";
import type { Reservation } from "../../drizzle/schema";
import {
  computeReservationPaymentSchedule,
  DAY_TRIP_ACOMPTE_PERCENT,
  getReservationCharterHours,
  isSunsetReservation,
} from "./commercialDocs";
import {
  CONTRACT_BANK_DETAILS,
  createContractWriters,
  dateEn,
  drawBullet,
  drawField,
  drawHeader,
  drawParagraph,
  drawSection,
  drawTitle,
  euro,
  sanitizePdfText,
  writerGap,
} from "./contractPdfUtils";

function formatHour(value: Date | string | null | undefined, fallbackHour = "00:00") {
  if (!value) return fallbackHour;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallbackHour;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  if (h === 0 && m === 0) return fallbackHour;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function buildDayCharterContractPdfEn(r: Reservation, contractNumber: string) {
  const { doc, writers } = await createContractWriters(5);
  const charterHours = getReservationCharterHours(r);
  const isSunset = isSunsetReservation(r);
  const datePrestation = dateEn(r.dateDebut) || "-";
  const embarkHour = formatHour(r.dateDebut, charterHours.embark);
  const disembarkHour = formatHour(r.dateFin, charterHours.disembark);
  const { acompteMontant, soldeMontant } = computeReservationPaymentSchedule(r);
  const fullName = String(r.nomClient || "-").trim();
  const phone = String(r.telClient || "-");
  const email = String(r.emailClient || "-");
  const destination = String(r.destination || "To be confirmed");
  const todayDate = dateEn(new Date()) || "-";
  const charterLabel = isSunset ? "Sunset Charter" : "Day Charter";

  // Page 1
  {
    const w = writers[0];
    drawHeader(w);
    drawTitle(w, "CREWED VESSEL CHARTER AGREEMENT");
    drawParagraph(w, `${charterLabel} - Private Catamaran`, { size: 10, bold: true });
    writerGap(w, 8);
    drawParagraph(
      w,
      'Between SAS 3L Yachting, operating the vessel SABINE (French flag, RIF no. RI937447), hereinafter "the Owner", and the client named below:',
      { size: 9.5 },
    );
    writerGap(w, 6);
    drawSection(w, "Booking information (auto-filled)");
    drawField(w, "File reference", contractNumber);
    drawField(w, "Full name", fullName);
    drawField(w, "Phone", phone);
    drawField(w, "Email", email);
    drawField(w, "Port / area", "La Ciotat");
    drawField(w, "Destination", destination);
    drawField(w, "Embarkation", `${datePrestation} at ${embarkHour}`);
    drawField(w, "Disembarkation", `${datePrestation} at ${disembarkHour}`);
    drawField(w, "Estimated duration", `${charterHours.durationHours} h`);
    drawField(w, "Fuel", "Included (local navigation)");
    drawField(w, "Total price incl. VAT", `${euro(r.montantTotal)} EUR`);
    drawField(w, `Deposit (${DAY_TRIP_ACOMPTE_PERCENT}%)`, `${euro(acompteMontant)} EUR`);
    drawField(w, "Balance (1 week before embarkation)", `${euro(soldeMontant)} EUR`);
    drawField(w, "Payment", `Bank transfer - IBAN ${CONTRACT_BANK_DETAILS.iban}`);
    const clientMsg = sanitizePdfText(String(r.message || "").trim() || "-");
    drawField(w, "Client message", clientMsg.length > 80 ? `${clientMsg.slice(0, 79)}...` : clientMsg);
  }

  // Page 2
  {
    const w = writers[1];
    drawHeader(w);
    drawSection(w, "ARTICLE 1 - PURPOSE OF THE AGREEMENT");
    drawParagraph(
      w,
      "This agreement covers the private use, with professional crew, of the vessel SABINE, a Lagoon 570 catamaran (approx. 17 m), maximum authorised day capacity: 12 passengers, for a day trip under the conditions set out below.",
    );
    drawSection(w, "ARTICLE 2 - DATE AND TIMES");
    drawParagraph(w, "See information box on page 1.");
    drawParagraph(
      w,
      "The captain alone decides actual timings according to weather, safety, maritime traffic or technical requirements.",
    );
    drawSection(w, "ARTICLE 3 - PRICE");
    drawParagraph(w, "The price shown on page 1 includes:");
    drawBullet(w, "Private use of the vessel");
    drawBullet(w, "Professional crew");
    drawBullet(w, "Fuel for normal local navigation");
    drawBullet(w, "Vessel insurance");
    drawBullet(w, "On-board leisure equipment (paddle, kayak, snorkelling when available)");
    drawBullet(w, "Standard cleaning after the trip");
    drawParagraph(w, "Unless otherwise stated, not included:");
    drawBullet(w, "Meals / drinks");
    drawBullet(w, "Land transfers");
    drawBullet(w, "Specific paid moorings");
    drawBullet(w, "Catering services");
    drawBullet(w, "Extra hours requested by the client");
  }

  // Page 3
  {
    const w = writers[2];
    drawHeader(w);
    drawBullet(w, "Damage caused by passengers");
    drawSection(w, "ARTICLE 4 - PAYMENT");
    drawBullet(w, "20% deposit upon booking");
    drawBullet(w, "Balance at least 7 days before embarkation");
    drawParagraph(w, "A booking is firm only after receipt of the deposit.");
    drawParagraph(w, "Payment by bank transfer or other means accepted by the Owner.");
    drawSection(w, "ARTICLE 5 - SECURITY DEPOSIT / DAMAGE");
    drawParagraph(
      w,
      "The Client is liable for damage caused by themselves or their guests on board. The Owner may claim reimbursement for repairs, losses or exceptional cleaning. A security deposit may be required before embarkation.",
    );
    drawSection(w, "ARTICLE 6 - CAPACITY AND PASSENGERS");
    drawParagraph(
      w,
      "The Client guarantees that the number embarked will never exceed the legal authorised capacity (12 in addition to the two crew members). The captain may refuse embarkation of any person who is manifestly intoxicated, behaves dangerously, fails to follow instructions, or exceeds capacity, without refund for the person concerned.",
    );
    drawSection(w, "ARTICLE 7 - SAFETY / CAPTAIN'S AUTHORITY");
    drawParagraph(w, "The captain alone is master on board regarding navigation, route, speed, anchorage, weather, safety of persons, alcohol consumption and use of equipment. All captain's instructions must be followed immediately.");
  }

  // Page 4
  {
    const w = writers[3];
    drawHeader(w);
    drawSection(w, "ARTICLE 8 - WEATHER / CHANGE / CANCELLATION");
    drawParagraph(w, "In case of unfavourable weather or safety risk, the Owner may:");
    drawBullet(w, "Reschedule the trip to another date");
    drawBullet(w, "Modify itinerary / programme");
    drawBullet(w, "Cancel with refund of amounts paid");
    drawParagraph(w, "No additional compensation may be claimed.");
    drawSection(w, "ARTICLE 9 - CANCELLATION BY THE CLIENT");
    drawBullet(w, "More than 30 days before: 25% of deposit retained");
    drawBullet(w, "30 to 7 days before: full deposit retained");
    drawBullet(w, "Less than 7 days before: 100% of price due");
    drawParagraph(w, "Unless the date is resold by the Owner.");
    drawSection(w, "ARTICLE 10 - LIABILITY");
    drawParagraph(w, "The Owner is insured in accordance with applicable regulations.");
    drawParagraph(w, "Passengers' personal belongings remain their responsibility.");
    drawParagraph(
      w,
      "Water activities (swimming, paddle, kayak, snorkelling) are undertaken at users' own risk and subject to the captain's approval.",
    );
  }

  // Page 5
  {
    const w = writers[4];
    drawHeader(w);
    drawSection(w, "ARTICLE 11 - IMAGE RIGHTS");
    drawParagraph(
      w,
      "Unless the Client objects in writing beforehand, general non-identifiable photos of the trip may be used for promotional purposes.",
    );
    drawSection(w, "ARTICLE 12 - DISPUTES");
    drawParagraph(w, "This agreement is governed by French law.");
    drawParagraph(
      w,
      "In case of dispute, jurisdiction is assigned to the courts of the Owner's registered office, unless mandatory law provides otherwise.",
    );
    writerGap(w, 24);
    drawSection(w, "SIGNATURES");
    drawParagraph(w, `Done at La Ciotat, on ${todayDate}`);
    writerGap(w, 8);
    drawParagraph(w, "The Client", { bold: true });
    drawParagraph(w, `Name: ${fullName}`);
    drawParagraph(w, 'Signature preceded by the words "Read and approved"');
    writerGap(w, 12);
    drawParagraph(w, "The Owner", { bold: true });
    drawParagraph(w, "For 3L Yachting");
    w.page.drawText(sanitizePdfText("SAS 3L Yachting"), { x: 320, y: 140, font: w.bold, size: 10, color: rgb(0.12, 0.12, 0.12) });
  }

  return await doc.save();
}
