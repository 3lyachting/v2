-- À exécuter une seule fois sur la base (ex. Render → PostgreSQL → Requêtes)
-- 9 semaines, produit Méditerranée (med), texte public Corse / Ajaccio
-- En cas de doublon, erreur: ignorer ou vider d'abord.

INSERT INTO "charterSlots" ("product", "debut", "fin", "active", "publicNote", "note")
VALUES
  ('med', '2026-07-04 00:00:00+00', '2026-07-10 23:59:59.999+00', true, 'Croisière Corse au départ d''Ajaccio', 'Corsica: juil.-août 2026 (seed)'),
  ('med', '2026-07-11 00:00:00+00', '2026-07-17 23:59:59.999+00', true, 'Croisière Corse au départ d''Ajaccio', 'Corsica: juil.-août 2026 (seed)'),
  ('med', '2026-07-18 00:00:00+00', '2026-07-24 23:59:59.999+00', true, 'Croisière Corse au départ d''Ajaccio', 'Corsica: juil.-août 2026 (seed)'),
  ('med', '2026-07-25 00:00:00+00', '2026-07-31 23:59:59.999+00', true, 'Croisière Corse au départ d''Ajaccio', 'Corsica: juil.-août 2026 (seed)'),
  ('med', '2026-08-01 00:00:00+00', '2026-08-07 23:59:59.999+00', true, 'Croisière Corse au départ d''Ajaccio', 'Corsica: juil.-août 2026 (seed)'),
  ('med', '2026-08-08 00:00:00+00', '2026-08-14 23:59:59.999+00', true, 'Croisière Corse au départ d''Ajaccio', 'Corsica: juil.-août 2026 (seed)'),
  ('med', '2026-08-15 00:00:00+00', '2026-08-21 23:59:59.999+00', true, 'Croisière Corse au départ d''Ajaccio', 'Corsica: juil.-août 2026 (seed)'),
  ('med', '2026-08-22 00:00:00+00', '2026-08-28 23:59:59.999+00', true, 'Croisière Corse au départ d''Ajaccio', 'Corsica: juil.-août 2026 (seed)'),
  ('med', '2026-08-29 00:00:00+00', '2026-09-04 23:59:59.999+00', true, 'Croisière Corse au départ d''Ajaccio', 'Corsica: juil.-août 2026 (seed)')
ON CONFLICT ("debut", "fin", "product") DO NOTHING;
