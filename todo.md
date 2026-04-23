# Sabine Sailing — TODO

- [x] Intégrer Stripe pour les paiements en ligne
- [x] Créer une page de réservation avec choix entre acompte 30% ou paiement complet
- [x] Créer le webhook Stripe pour confirmer les réservations
- [x] Afficher les réservations payées dans le backoffice admin
- [x] Envoyer email de confirmation après paiement réussi (via Stripe receipt + notifyOwner)
- [x] Tests Vitest pour l'API Stripe (4 tests passés)
- [ ] Ajouter authentification OAuth pour sécuriser l'admin (actuellement login simple)

- [x] BUG : Le bouton "Espace administrateur" redirige vers l'accueil au lieu de /admin/login

- [x] Implémenter l'import iCal depuis Google Agenda (URL secrète privée)
- [x] Ajouter une table config pour stocker l'URL iCal et permettre au backoffice de la modifier
- [x] Ajouter un sélecteur de destination au-dessus du calendrier
- [x] Faire sauter le calendrier à la prochaine disponibilité de la destination choisie
- [x] Implémenter config iCal Google Calendar dans le backoffice (composant séparé ConfigIcal)
- [x] Corriger les erreurs JSX du fichier Admin.tsx proprement
- [x] Méditerranée/Caraïbes : 4 cabines doubles, réservation bateau entier OU cabine
- [x] Transat : 4 places à réserver individuellement
- [x] Adapter le tarif selon bateau entier vs cabine
- [ ] Tests Vitest pour les routes iCal et le flux de réservation cabine
- [ ] Permettre de saisir le tarif cabine et la capacité dans le formulaire admin

- [x] Remplacer le paiement Stripe par un simple formulaire de demande de réservation
- [x] Stocker les demandes dans la base et les afficher dans le backoffice admin
- [x] Notifier par email quand une nouvelle demande arrive
- [ ] Nettoyer les routes Stripe inutilisées (création de session, webhook)
- [x] Tester le flux complet : formulaire → admin → notification
- [x] Vérifier que la nouvelle demande s'affiche correctement dans l'admin avec tous les champs
- [x] Corriger l'erreur iCal "Cannot read properties of undefined (reading 'fromURL')" - changement import ES modules
- [x] Corriger le bug de décalage des dates au calendrier (conversion complète en UTC)
- [x] Créer la structure de données pour gérer les cabines par semaine
- [x] Implémenter l'interface de gestion des cabines dans le backoffice
- [x] Intégrer la gestion des cabines avec le formulaire de réservation
- [x] Ajouter routes API PUT/DELETE pour modifier/supprimer les réservations
- [x] Ajouter interface d'édition des réservations dans l'admin
- [x] Ajouter bouton "Envoyer confirmation" pour notifier le client
- [x] Tester la modification et suppression de réservations
