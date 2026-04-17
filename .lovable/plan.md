
## CipherRoom — Messagerie chiffrée immersive

Une app de messagerie éphémère, anonyme, avec une identité visuelle **unique** (pas un énième clone Matrix). Direction artistique : *"signal radio interceptée"* — entre console de sous-marin, station d'écoute des années 70 et interface d'IA bienveillante. Couleurs ambrées/cuivre sur fond charbon profond, typographie mécanique, lumière qui "respire", textures organiques (bruit, grain), et micro-animations narratives qui racontent une histoire à chaque action.

### Direction artistique (la touche unique)

- **Palette** : charbon profond + ambre cuivré + blanc os, accents vert oscilloscope très ponctuels. Pas de néon agressif.
- **Typo** : mono pour le contenu technique (clés, hash), serif mécanique pour les messages (lisibilité + caractère).
- **Signature visuelle** : un **"oscilloscope vivant"** en arrière-plan qui réagit aux frappes et aux messages reçus (waveform douce). Grain de film léger, vignette, lueur ambrée pulsée.
- **Sons discrets** (toggleable) : clics mécaniques, "ping" d'onde courte à la réception.
- **Boot sequence** narratif à l'arrivée : faux logs poétiques de connexion ("Établissement du canal... brouillage actif... vous êtes invisible").

### Pages & flux

1. **Accueil `/`** — Hero immersif avec oscilloscope animé. Deux actions : *"Créer un salon"* et *"Rejoindre via lien"*. Génération automatique d'un pseudo aléatoire stylisé (ex: `ember-fox-7421`).
2. **Création de salon `/new`** — Choix de la durée de vie (15 min, 1h, 24h, jusqu'à fermeture), TTL des messages (instantané, 30s, 5 min, persistant pour la session), nombre max de participants. Génération du lien d'invitation + QR code + **empreinte de clé** du salon à partager.
3. **Salon `/r/$roomId`** — Cœur de l'app :
   - Liste des participants avec leur empreinte courte (vérifiable)
   - Zone de chat avec effet **typewriter** à la réception, animation de "déchiffrement" (caractères qui se stabilisent depuis du hex)
   - Indicateur "frappe en cours" stylisé en waveform
   - Bouton **vérification d'empreinte** (modal avec QR + mots de sécurité type BIP39)
   - Compte à rebours visible pour chaque message éphémère
   - **Détection de capture d'écran** (navigateur : visibilitychange + blur, alerte dans le chat *"⚠ ember-fox a quitté la fenêtre"*) — honnête sur les limites
   - **Mode panique** : raccourci `Ctrl+.` → wipe instantané + redirection vers un faux écran (au choix : page 404 navigateur, calculatrice, météo)
4. **Salon expiré `/r/$roomId/expired`** — Écran narratif "le canal s'est refermé".
5. **À propos `/about`** — Explication honnête du modèle de sécurité (E2EE simple côté navigateur, ce qui est protégé, ce qui ne l'est pas).

### Modèle technique (Lovable Cloud)

- **Anonyme** : pas de compte. Identité = paire de clés ECDH générée dans le navigateur, stockée en `sessionStorage` (disparaît à la fermeture). Pseudo dérivé de la clé.
- **Chiffrement hybride réel et simple** :
  - Web Crypto API : ECDH (P-256) pour échange de clés, AES-GCM pour les messages
  - Le serveur ne stocke que `{ room_id, sender_fingerprint, ciphertext, iv, expires_at }` — aucun contenu lisible
  - Empreinte = SHA-256 tronqué de la clé publique (affiché en hex + mots BIP39)
- **Realtime** via Supabase Realtime sur la table `messages` (filtrée par `room_id`)
- **Tables** : `rooms` (id, expires_at, max_participants, created_at), `messages` (id, room_id, sender_pubkey, ciphertext, iv, expires_at), `room_participants` (room_id, pubkey, pseudo, joined_at)
- **RLS** : lecture/écriture sur un salon uniquement si on connaît son id (id = secret partagé via le lien). Purge automatique des messages/salons expirés via une fonction edge planifiée *(à activer ultérieurement)*.

### Effets cinématiques inclus

- Boot sequence à l'entrée du salon (3-4s, skippable)
- Animation de déchiffrement caractère par caractère à la réception
- Oscilloscope de fond qui pulse à chaque message
- Faux flux de hex défilant subtilement en bordure
- Glitch léger sur l'apparition d'un nouveau participant
- ASCII art discret dans les en-têtes de salon

### Hors périmètre v1 (pour plus tard)

- Vrai Perfect Forward Secrecy (Double Ratchet)
- Appels audio/vidéo
- Pièces jointes chiffrées
- Salons de groupe persistants avec comptes
- App mobile native

### Avertissement intégré

Bandeau honnête à la création : *"CipherRoom est une expérience. Pour des besoins critiques, utilisez Signal."* — crédibilise le projet et évite tout malentendu.
