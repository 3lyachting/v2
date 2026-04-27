-- Semaine: embarquement samedi 16h, débarquement samedi 9h (7 nuits, samedi--samedi)
-- 9 plages, produit med, texte public. Doublon: ON CONFLICT ignore.

INSERT INTO "charterSlots" ("product", "debut", "fin", "active", "publicNote", "note")
VALUES
  ('med', '2026-07-04 00:00:00+00', '2026-07-10 23:59:59.999+00', true, 'Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d''Ajaccio.', 'Corsica: juil.-août 2026 (seed) · embarq. 16h / debarq. 9h'),
  ('med', '2026-07-11 00:00:00+00', '2026-07-17 23:59:59.999+00', true, 'Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d''Ajaccio.', 'Corsica: juil.-août 2026 (seed) · embarq. 16h / debarq. 9h'),
  ('med', '2026-07-18 00:00:00+00', '2026-07-24 23:59:59.999+00', true, 'Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d''Ajaccio.', 'Corsica: juil.-août 2026 (seed) · embarq. 16h / debarq. 9h'),
  ('med', '2026-07-25 00:00:00+00', '2026-07-31 23:59:59.999+00', true, 'Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d''Ajaccio.', 'Corsica: juil.-août 2026 (seed) · embarq. 16h / debarq. 9h'),
  ('med', '2026-08-01 00:00:00+00', '2026-08-07 23:59:59.999+00', true, 'Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d''Ajaccio.', 'Corsica: juil.-août 2026 (seed) · embarq. 16h / debarq. 9h'),
  ('med', '2026-08-08 00:00:00+00', '2026-08-14 23:59:59.999+00', true, 'Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d''Ajaccio.', 'Corsica: juil.-août 2026 (seed) · embarq. 16h / debarq. 9h'),
  ('med', '2026-08-15 00:00:00+00', '2026-08-21 23:59:59.999+00', true, 'Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d''Ajaccio.', 'Corsica: juil.-août 2026 (seed) · embarq. 16h / debarq. 9h'),
  ('med', '2026-08-22 00:00:00+00', '2026-08-28 23:59:59.999+00', true, 'Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d''Ajaccio.', 'Corsica: juil.-août 2026 (seed) · embarq. 16h / debarq. 9h'),
  ('med', '2026-08-29 00:00:00+00', '2026-09-04 23:59:59.999+00', true, 'Semaine samedi – samedi: embarquement samedi 16h, débarquement samedi 9h. Croisière Corse au départ d''Ajaccio.', 'Corsica: juil.-août 2026 (seed) · embarq. 16h / debarq. 9h')
ON CONFLICT ("debut", "fin", "product") DO NOTHING;
