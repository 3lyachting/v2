CREATE TYPE "public"."customer_auth_method" AS ENUM('magic_link', 'password');--> statement-breakpoint
CREATE TYPE "public"."disponibilite_statut" AS ENUM('disponible', 'reserve', 'option', 'ferme');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('identity', 'reservation', 'boat');--> statement-breakpoint
CREATE TYPE "public"."esign_provider" AS ENUM('yousign', 'docusign', 'other');--> statement-breakpoint
CREATE TYPE "public"."planning_type" AS ENUM('charter', 'technical_stop', 'maintenance', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."reservation_request_status" AS ENUM('nouvelle', 'en_cours', 'validee', 'refusee', 'archivee');--> statement-breakpoint
CREATE TYPE "public"."reservation_workflow_statut" AS ENUM('demande', 'refusee', 'validee_owner', 'devis_emis', 'devis_accepte', 'contrat_envoye', 'contrat_signe', 'acompte_attente', 'acompte_confirme', 'facture_emise', 'solde_attendu', 'solde_confirme');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."statut_paiement" AS ENUM('en_attente', 'paye', 'echec', 'rembourse');--> statement-breakpoint
CREATE TYPE "public"."type_paiement" AS ENUM('acompte', 'complet');--> statement-breakpoint
CREATE TYPE "public"."type_reservation" AS ENUM('bateau_entier', 'cabine', 'place');--> statement-breakpoint
CREATE TABLE "avis" (
	"id" serial PRIMARY KEY NOT NULL,
	"nom" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"note" integer NOT NULL,
	"titre" varchar(255) NOT NULL,
	"contenu" text NOT NULL,
	"destination" varchar(255),
	"approuve" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cabinesReservees" (
	"id" serial PRIMARY KEY NOT NULL,
	"disponibiliteId" integer NOT NULL,
	"nbReservees" integer DEFAULT 0 NOT NULL,
	"nbTotal" integer DEFAULT 4 NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config" (
	"id" serial PRIMARY KEY NOT NULL,
	"cle" varchar(100) NOT NULL,
	"valeur" text,
	"description" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "config_cle_unique" UNIQUE("cle")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservationId" integer NOT NULL,
	"quoteId" integer,
	"contractNumber" varchar(50) NOT NULL,
	"pdfStorageKey" text,
	"esignProvider" "esign_provider" DEFAULT 'other' NOT NULL,
	"esignEnvelopeId" varchar(255),
	"sentAt" timestamp,
	"signedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_contractNumber_unique" UNIQUE("contractNumber")
);
--> statement-breakpoint
CREATE TABLE "crewMembers" (
	"id" serial PRIMARY KEY NOT NULL,
	"fullName" varchar(180) NOT NULL,
	"role" varchar(120) NOT NULL,
	"phone" varchar(50),
	"email" varchar(320),
	"certifications" text,
	"availabilityNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customerMagicLinks" (
	"id" serial PRIMARY KEY NOT NULL,
	"customerEmail" varchar(320) NOT NULL,
	"tokenHash" varchar(255) NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"usedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customerMagicLinks_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"firstName" varchar(120),
	"lastName" varchar(120),
	"phone" varchar(50),
	"authMethod" "customer_auth_method" DEFAULT 'magic_link' NOT NULL,
	"passwordHash" text,
	"emailVerifiedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "disponibilites" (
	"id" serial PRIMARY KEY NOT NULL,
	"planningType" "planning_type" DEFAULT 'charter' NOT NULL,
	"debut" timestamp NOT NULL,
	"fin" timestamp NOT NULL,
	"statut" "disponibilite_statut" NOT NULL,
	"tarif" integer,
	"tarifCabine" integer,
	"tarifJourPersonne" integer,
	"tarifJourPriva" integer,
	"destination" varchar(255) NOT NULL,
	"capaciteTotale" integer DEFAULT 4 NOT NULL,
	"cabinesReservees" integer DEFAULT 0 NOT NULL,
	"note" text,
	"notePublique" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservationId" integer,
	"customerId" integer,
	"category" "document_category" NOT NULL,
	"docType" varchar(80) NOT NULL,
	"originalName" varchar(255) NOT NULL,
	"mimeType" varchar(120) NOT NULL,
	"sizeBytes" integer NOT NULL,
	"storageKey" text NOT NULL,
	"isSensitive" boolean DEFAULT true NOT NULL,
	"expiresAt" timestamp,
	"uploadedByType" varchar(20) NOT NULL,
	"uploadedById" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esignEvents" (
	"id" serial PRIMARY KEY NOT NULL,
	"contractId" integer NOT NULL,
	"provider" "esign_provider" DEFAULT 'other' NOT NULL,
	"eventType" varchar(80) NOT NULL,
	"payload" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservationId" integer NOT NULL,
	"invoiceNumber" varchar(50) NOT NULL,
	"invoiceType" varchar(30) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'EUR' NOT NULL,
	"dueAt" timestamp,
	"paidAt" timestamp,
	"pdfStorageKey" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoiceNumber_unique" UNIQUE("invoiceNumber")
);
--> statement-breakpoint
CREATE TABLE "maintenanceTasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"system" varchar(120) NOT NULL,
	"boatArea" varchar(120),
	"intervalHours" integer,
	"intervalDays" integer,
	"lastDoneEngineHours" integer,
	"currentEngineHours" integer,
	"lastDoneAt" timestamp,
	"nextDueAt" timestamp,
	"sparePartsLocation" text,
	"boatPlanRef" text,
	"procedureNote" text,
	"isCritical" boolean DEFAULT false NOT NULL,
	"isDone" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paymentConfirmations" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservationId" integer NOT NULL,
	"invoiceId" integer,
	"paymentType" varchar(20) NOT NULL,
	"amount" integer NOT NULL,
	"confirmedBy" integer,
	"confirmedAt" timestamp DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservationId" integer NOT NULL,
	"quoteNumber" varchar(50) NOT NULL,
	"totalAmount" integer NOT NULL,
	"currency" varchar(10) DEFAULT 'EUR' NOT NULL,
	"pdfStorageKey" text,
	"sentAt" timestamp,
	"acceptedAt" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_quoteNumber_unique" UNIQUE("quoteNumber")
);
--> statement-breakpoint
CREATE TABLE "reservationStatusHistory" (
	"id" serial PRIMARY KEY NOT NULL,
	"reservationId" integer NOT NULL,
	"fromStatut" "reservation_workflow_statut",
	"toStatut" "reservation_workflow_statut" NOT NULL,
	"actorType" varchar(30) NOT NULL,
	"actorId" integer,
	"note" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"nomClient" varchar(255) NOT NULL,
	"prenomClient" varchar(120),
	"emailClient" varchar(320) NOT NULL,
	"customerId" integer,
	"telClient" varchar(50),
	"nbPersonnes" integer NOT NULL,
	"disponibiliteId" integer,
	"formule" varchar(50) NOT NULL,
	"typeReservation" "type_reservation" DEFAULT 'bateau_entier' NOT NULL,
	"nbCabines" integer DEFAULT 1 NOT NULL,
	"destination" varchar(255) NOT NULL,
	"dateDebut" timestamp NOT NULL,
	"dateFin" timestamp NOT NULL,
	"montantTotal" integer NOT NULL,
	"typePaiement" "type_paiement" NOT NULL,
	"montantPaye" integer NOT NULL,
	"stripeSessionId" varchar(255),
	"stripePaymentIntentId" varchar(255),
	"statutPaiement" "statut_paiement" DEFAULT 'en_attente' NOT NULL,
	"workflowStatut" "reservation_workflow_statut" DEFAULT 'demande' NOT NULL,
	"requestStatus" "reservation_request_status" DEFAULT 'nouvelle' NOT NULL,
	"internalComment" text,
	"archivedAt" timestamp,
	"acomptePercent" integer DEFAULT 20 NOT NULL,
	"acompteMontant" integer DEFAULT 0 NOT NULL,
	"soldeMontant" integer DEFAULT 0 NOT NULL,
	"soldeEcheanceAt" timestamp,
	"ownerValidatedAt" timestamp,
	"ownerValidatedBy" integer,
	"message" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
