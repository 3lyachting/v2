import { rgb } from "pdf-lib";
import type { Reservation } from "../../drizzle/schema";
import {
  computeReservationPaymentSchedule,
  getReservationCharterHours,
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

function formatEnDateTime(value: Date | string | null | undefined, fallbackHour = "00:00") {
  const d = value ? new Date(value) : null;
  const datePart = dateEn(d);
  if (!d || Number.isNaN(d.getTime())) return `${datePart} at ${fallbackHour}`;
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const hour = h === 0 && m === 0 ? fallbackHour : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return `${datePart} at ${hour}`;
}

export async function buildWeekCharterContractPdfEn(r: Reservation, contractNumber: string) {
  const { doc, writers } = await createContractWriters(9);
  const isPrivate = r.typeReservation === "bateau_entier";
  const charterHours = getReservationCharterHours(r);
  const [firstNameRaw, ...lastNameParts] = String(r.nomClient || "").trim().split(/\s+/);
  const firstName = firstNameRaw || "-";
  const lastName = lastNameParts.join(" ") || "-";
  const fullName = String(r.nomClient || "-").trim();
  const { acompteMontant, soldeMontant, soldeEcheanceAt } = computeReservationPaymentSchedule(r);
  const today = dateEn(new Date());

  // Page 1
  {
    const w = writers[0];
    drawHeader(w);
    drawTitle(w, "UNIFIED CHARTER AGREEMENT - Sabine Sailing");
    drawParagraph(w, "Cabin cruise - Full vessel charter - Complete annexes", { size: 9.5 });
    writerGap(w, 6);
    drawField(w, "File reference", contractNumber);
    drawField(w, "Client / lead passenger", fullName);
    drawField(w, "Phone", String(r.telClient || "-"));
    drawField(w, "Email", String(r.emailClient || "-"));
    drawField(w, "Vessel", "Catamaran Sabine");
    drawField(w, "Destination / itinerary", String(r.destination || "-"));
    drawField(w, "Embarkation date", formatEnDateTime(r.dateDebut, charterHours.embark));
    drawField(w, "Disembarkation date", formatEnDateTime(r.dateFin, charterHours.disembark));
    writerGap(w, 4);
    drawSection(w, "TYPE OF SERVICE (tick one)");
    drawParagraph(w, `${isPrivate ? "[ ]" : "[X]"} CABIN CRUISE`);
    drawParagraph(w, `${isPrivate ? "[X]" : "[ ]"} FULL VESSEL CHARTER WITH CREW`);
    writerGap(w, 6);
    drawSection(w, "PART A - COMMON CONDITIONS");
    drawParagraph(
      w,
      "Any booking implies acceptance of these conditions. The captain alone is master on board and responsible for the safety of persons, the vessel and the environment. Itineraries are indicative and may be changed for weather, technical or safety reasons.",
    );
    drawBullet(w, "Mandatory compliance with safety briefing and instructions.");
    drawBullet(w, "Weapons, illicit substances and dangerous behaviour are prohibited.");
    drawBullet(w, "Personal insurance recommended (cancellation, repatriation, medical).");
    drawBullet(w, "Any claim must be submitted within 30 days after disembarkation.");
    drawSection(w, "Payments and cancellation (standard scale)");
    drawBullet(w, "Deposit upon booking: see Part B or C.");
    drawBullet(w, "Recommended scale: >90 days 25% - 89-60 days 50% - 59-30 days 75% - <30 days 100%.");
    drawBullet(w, "No-show = 100% of amount due.");
  }

  // Page 2 - Part B cabin
  {
    const w = writers[1];
    drawHeader(w);
    drawTitle(w, "PART B - CABIN CRUISE AGREEMENT");
    drawParagraph(
      w,
      "The client books one or more berths on board a vessel shared with other passengers.",
    );
    drawSection(w, "Included");
    drawBullet(w, "Accommodation in cabin according to category booked.");
    drawBullet(w, "Services of captain and mate / cook.");
    drawBullet(w, "Full board (except lunch on arrival/departure day if applicable).");
    drawBullet(
      w,
      "Drinks (water, tea, coffee, table wine, juice, soft drinks and 1 cocktail per evening per person during meals).",
    );
    drawBullet(w, "Fuel required for standard programme.");
    drawBullet(w, "On-board leisure equipment: snorkelling, paddles and kayak.");
    drawBullet(w, "Owner's third-party liability insurance.");
    drawSection(w, "Not included");
    drawBullet(w, "Transport to/from embarkation port.");
    drawBullet(w, "Alcoholic drinks outside the formula.");
    drawBullet(w, "Personal expenses and shore activities.");
    drawBullet(w, "Passengers' personal insurance.");
    drawBullet(w, "Options: towed buoy, underwater scooters, electric paddle motor.");
    drawSection(w, "Payments");
    drawBullet(w, "Deposit: 20% upon booking - Balance: 45 days before departure.");
    drawField(w, "Total cabin price", `${euro(r.montantTotal)} EUR`);
    drawField(w, "Deposit (20%)", `${euro(acompteMontant)} EUR`);
    drawField(w, "Balance", `${euro(soldeMontant)} EUR by ${dateEn(soldeEcheanceAt)}`);
    drawField(w, "Payment", `Bank transfer - IBAN ${CONTRACT_BANK_DETAILS.iban}`);
  }

  // Page 3 - Part C private
  {
    const w = writers[2];
    drawHeader(w);
    drawTitle(w, "PART C - FULL VESSEL CHARTER WITH CREW");
    drawParagraph(
      w,
      "The client books exclusive use of the vessel with professional crew. The captain retains full authority over navigation and safety.",
    );
    drawSection(w, "Included");
    drawBullet(w, "Exclusive use of vessel with crew.");
    drawBullet(w, "On-board accommodation within authorised capacity.");
    drawBullet(w, "2 stand-up paddles and one kayak.");
    drawSection(w, "NOT INCLUDED IN PRIVATE CHARTER");
    drawParagraph(
      w,
      "Fuel, food provisioning and drinks are NOT included. These costs depend on the chosen programme, distances sailed and desired catering level. A ship's purse or provisioning budget is set before departure. Unused balance is returned at end of cruise.",
    );
    drawBullet(w, "Options: towed buoy, underwater scooters, electric paddle motor.");
    drawSection(w, "Payments");
    drawBullet(w, "Deposit: 10% upon booking - Balance: 60 days before departure.");
    drawField(w, "Total private charter price", `${euro(r.montantTotal)} EUR`);
    if (isPrivate) {
      const privateDeposit = Math.round(r.montantTotal * 0.1);
      const privateBalance = Math.max(0, r.montantTotal - privateDeposit);
      drawField(w, "Deposit (10%)", `${euro(privateDeposit)} EUR`);
      drawField(w, "Balance", `${euro(privateBalance)} EUR`);
    }
    drawField(w, "Payment", `Bank transfer - IBAN ${CONTRACT_BANK_DETAILS.iban}`);
  }

  // Page 4 - T&C 1-6
  {
    const w = writers[3];
    drawHeader(w);
    drawTitle(w, "GENERAL TERMS AND CONDITIONS FOR PASSENGERS");
    drawParagraph(w, "SAS 3L Yachting - Catamaran Sabine - Private and cabin cruises - Mediterranean and Caribbean");
    drawSection(w, "1. Service");
    drawParagraph(
      w,
      "Vessel type, crew composition, service content and destination are as stated on the order form or contract.",
    );
    drawSection(w, "2. Price - included");
    drawBullet(w, "Use and maintenance of the vessel.");
    drawBullet(w, "Wages and social charges of professional crew.");
    drawBullet(w, "Vessel insurance and owner's third-party liability.");
    drawBullet(w, "Hotel and catering services as stated in the contract.");
    drawBullet(w, "Fuel and consumables when included in the formula (notably cabin cruise).");
    drawSection(w, "3. Price - not included");
    drawBullet(w, "Transport to embarkation port and return.");
    drawBullet(w, "Passengers' personal insurance (cancellation, repatriation, medical, baggage).");
    drawBullet(w, "Personal expenses and shore activities.");
    drawBullet(w, "In private charter: fuel, food provisioning and drinks.");
    drawSection(w, "4. Ship's purse (if applicable)");
    drawParagraph(
      w,
      "A flat-rate or estimated ship's purse may be requested covering local taxes, port fees, clearances and variable consumption. Terms are stated in the contract. Generally EUR 30 per day per person; surplus returned at end of cruise (Advanced Provisioning Allowance).",
    );
    drawSection(w, "5. Comfort and life on board");
    drawParagraph(
      w,
      "Cabin allocation depends on availability. Soft bags are recommended. Crew maintains common areas; cabins remain passengers' responsibility. Items that may damage sanitary fittings or equipment may be charged for reinstatement. Sun protection is strongly recommended.",
    );
    drawSection(w, "6. Embarkation and disembarkation");
    drawParagraph(
      w,
      "Embarkation and disembarkation times are stated in the contract. Early access cannot be guaranteed. If a passenger is late, the vessel may sail so as not to penalise other participants.",
    );
  }

  // Page 5 - T&C 7-11
  {
    const w = writers[4];
    drawHeader(w);
    drawTitle(w, "GENERAL TERMS AND CONDITIONS (continued)");
    drawSection(w, "7. Crew duties");
    drawParagraph(
      w,
      "The captain is responsible for conduction, safety and navigation. The mate / hostess / cook provides cooking, service and hotel tasks as per the contract.",
    );
    drawSection(w, "8. Safety, regulations and behaviour");
    drawBullet(w, "Passengers must attend the safety briefing and follow the captain's instructions.");
    drawBullet(w, "Weapons, illicit substances or material prohibited by local regulations are forbidden.");
    drawBullet(w, "The captain may refuse embarkation or disembark any passenger whose behaviour endangers the cruise.");
    drawSection(w, "9. Health and fitness");
    drawParagraph(
      w,
      "Passengers must report any health issue or special situation before booking that may affect safety on board. Crew does not provide medical supervision or childcare.",
    );
    drawSection(w, "10. Force majeure");
    drawParagraph(
      w,
      "Force majeure includes severe weather, major breakdown, administrative decisions, conflicts, health events or any event beyond the owner's reasonable control. The captain alone judges decisions to be taken. The organiser may modify, postpone or cancel the service with refund only of amounts received for services not provided.",
    );
    drawSection(w, "11. Cancellation / modification / payments");
    drawParagraph(
      w,
      "Payment of a deposit constitutes acceptance of these terms. Late payment may result in cancellation and application of cancellation fees. Failure to present at departure constitutes cancellation with full billing of amounts due.",
    );
    drawParagraph(
      w,
      "The captain may modify the itinerary, reverse the circuit or replace ports for weather, safety or operational constraints.",
    );
  }

  // Page 6 - T&C 12-14
  {
    const w = writers[5];
    drawHeader(w);
    drawTitle(w, "GENERAL TERMS AND CONDITIONS (continued)");
    drawSection(w, "12. Modifications by the client");
    drawParagraph(
      w,
      "Any modification request is subject to availability and may incur fees. Name changes may be accepted under conditions stated by the organiser.",
    );
    drawSection(w, "13. Claims");
    drawParagraph(w, "Any claim must be submitted in writing within a maximum of 30 days after disembarkation.");
    drawSection(w, "14. Applicable law and jurisdiction");
    drawParagraph(
      w,
      "These terms are governed by French law. Exclusive jurisdiction of the courts of the organiser's registered office (Marseille).",
    );
  }

  // Page 7 - Annex 1
  {
    const w = writers[6];
    drawHeader(w);
    drawTitle(w, "ANNEX 1 - PRACTICAL INFORMATION FOR PASSENGERS");
    drawParagraph(
      w,
      "Sun: exposure at sea is stronger than on land. Bring a windproof cap, glasses with cord, high SPF sunscreen and covering clothing for the first days.",
    );
    drawParagraph(
      w,
      "Baggage: space on board is limited. Soft, easily stowed bags are preferred to rigid suitcases.",
    );
    drawParagraph(
      w,
      "Towels and linen: on-board linen is provided according to the chosen formula. Bring personal items and protection suited to your sensitivity.",
    );
    drawParagraph(
      w,
      "Water: on-board reserves and/or watermaker allow comfort, but responsible use is requested for environmental and operational reasons.",
    );
    drawParagraph(
      w,
      "Sports equipment: masks, fins and snorkels may be provided. Passengers may bring their own. Absolute respect for coral and the marine environment.",
    );
    drawParagraph(
      w,
      "Manoeuvres: no nautical knowledge required. Optional participation only with the captain's agreement.",
    );
    drawParagraph(
      w,
      "Life on board: crew does its best to satisfy passengers, without obligation of result on specific diets depending on provisioning areas.",
    );
    drawParagraph(
      w,
      "Personal belongings: the owner declines liability for loss, theft or damage. Valuables are discouraged on board.",
    );
    writerGap(w, 8);
    drawSection(w, "ANNEX 2 - PASSENGER BRIEFING AT EMBARKATION");
    drawBullet(w, "General presentation of the vessel and tour.");
    drawBullet(w, "Safety equipment: life jackets, fire extinguishers, survival hatches, alerting means.");
    drawBullet(w, "Water and electricity management on board.");
    drawBullet(w, "Correct use of marine toilets and blockage risks.");
  }

  // Page 8 - Annex 2 cont + Annex 3
  {
    const w = writers[7];
    drawHeader(w);
    drawTitle(w, "ANNEX 2 (continued) AND ANNEX 3");
    drawBullet(w, "Movement rules on board and in port.");
    drawBullet(w, "Swimming, paddle and kayak rules.");
    drawBullet(w, "Smoking areas and waste management.");
    drawSection(w, "ANNEX 3 - SAFETY INSTRUCTIONS TO BE SIGNED BY PASSENGERS");
    drawParagraph(
      w,
      "Navigation requires strict compliance with safety rules. Each passenger acknowledges having attended the briefing and agrees to apply the following:",
    );
    drawBullet(w, "Wear life jacket for any movement on deck at night, in dinghy or when required by the captain.");
    drawBullet(w, "Do not move alone on deck at night without notifying crew.");
    drawBullet(w, "Use harness and lifelines when requested by the captain.");
    drawBullet(w, "Never open survival hatches except in absolute emergency.");
    drawBullet(w, "Wait for manoeuvres to finish and engines to stop before swimming.");
    drawBullet(w, "Never dive without captain's authorisation and never swim alone.");
    drawBullet(w, "Do not climb unauthorised areas or dive from the roof.");
    drawBullet(w, "Close portholes during navigation to avoid water ingress.");
    drawBullet(w, "Smoking strictly forbidden inside the vessel.");
    drawBullet(w, "Weapons, illicit substances or prohibited items are forbidden.");
    drawBullet(w, "Children remain under direct and permanent responsibility of parents or guardians.");
    drawBullet(w, "Damage to on-board equipment may be charged to the responsible passenger.");
    drawParagraph(
      w,
      "The captain may refuse embarkation or disembark any passenger whose behaviour endangers persons or the vessel, without refund.",
    );
    drawSection(w, "PASSENGER SIGNATURES - ANNEX 3");
    drawParagraph(w, "I acknowledge the safety instructions and undertake to comply strictly.");
    for (let i = 0; i < 4; i++) {
      drawParagraph(w, "Name: ______________________   Signature: ______________________   Date: __________");
    }
  }

  // Page 9 - Signatures
  {
    const w = writers[8];
    drawHeader(w);
    drawTitle(w, "SIGNATURES");
    drawParagraph(w, `Period: ${dateEn(r.dateDebut)} to ${dateEn(r.dateFin)}`);
    drawParagraph(w, `Total: ${euro(r.montantTotal)} EUR`, { bold: true });
    writerGap(w, 8);
    drawParagraph(w, "Document generated from the contractual template.");
    writerGap(w, 20);
    drawParagraph(w, "Client signature", { bold: true });
    drawParagraph(w, `Name: ${lastName} ${firstName !== "-" ? firstName : ""}`.trim());
    drawParagraph(w, 'Read and approved - Signature: ___________________________');
    writerGap(w, 16);
    drawParagraph(w, "Owner signature", { bold: true });
    w.page.drawText(sanitizePdfText("SAS 3L Yachting"), { x: 40, y: w.y, font: w.bold, size: 10, color: rgb(0.12, 0.12, 0.12) });
    w.y -= 20;
    w.page.drawText(sanitizePdfText(`Date: ${today}`), { x: 40, y: w.y, font: w.font, size: 9, color: rgb(0.12, 0.12, 0.12) });
  }

  return await doc.save();
}
