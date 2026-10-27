import { createFileRoute } from "@tanstack/react-router";
import { Oscilloscope } from "@/components/Oscilloscope";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "À propos — CipherRoom" },
      {
        name: "description",
        content: "Modèle de sécurité de CipherRoom, ce qui est protégé et ce qui ne l'est pas.",
      },
      { property: "og:title", content: "À propos — CipherRoom" },
      {
        property: "og:description",
        content: "Modèle de sécurité de CipherRoom, ce qui est protégé et ce qui ne l'est pas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "À propos — CipherRoom" },
      {
        name: "twitter:description",
        content: "Modèle de sécurité de CipherRoom, ce qui est protégé et ce qui ne l'est pas.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="relative min-h-screen overflow-hidden scan-lines">
      <Oscilloscope className="absolute inset-0 w-full h-full opacity-20" />
      <div className="relative z-10 max-w-2xl mx-auto px-6 py-12 font-serif">
        <a
          href="/"
          className="font-mono text-xs text-muted-foreground hover:text-primary tracking-widest"
        >
          ← RETOUR
        </a>
        <h1 className="font-serif text-5xl text-bone mt-8 mb-2">
          À propos de <span className="text-primary glow-amber italic">CipherRoom</span>
        </h1>
        <p className="text-muted-foreground italic mb-10">
          Honnêteté radicale sur ce que cet outil fait et ne fait pas.
        </p>

        <Section title="Ce que CipherRoom protège">
          <ul className="space-y-2 list-disc list-inside">
            <li>Le contenu de vos messages : chiffré côté navigateur (AES-256-GCM) avant envoi.</li>
            <li>Votre identité : aucune inscription, pseudo généré aléatoirement. Les pseudos et empreintes ne sont pas authentifiés : un participant malveillant peut en usurper un autre.</li>
            <li>L'historique : les salons et messages s'auto-effacent à expiration. Le serveur et son hébergeur conservent toutefois des journaux techniques de requêtes (adresse IP, horaires) hors de notre contrôle.</li>
          </ul>
        </Section>

        <Section title="Ce que CipherRoom ne protège pas">
          <ul className="space-y-2 list-disc list-inside">
            <li>Un appareil compromis (malware, keylogger).</li>
            <li>Le partage du lien d'invitation à un tiers — quiconque l'a peut entrer.</li>
            <li>Le Perfect Forward Secrecy avancé (Signal le fait, pas nous).</li>
            <li>Les métadonnées : durée, nombre de participants, heures et taille des messages, pseudos et empreintes sont visibles côté serveur.</li>
          </ul>
        </Section>

        <Section title="Le bouclier anti-capture : ce qu'il fait vraiment">
          <p>
            Le canal surveille les raccourcis clavier de capture connus (Impr. écran,
            Win+Maj+S, Cmd+Maj+3/4/5), la perte de focus de la fenêtre et les demandes
            d'impression. Sur mobile (Android, iOS) il surveille en plus les gestes à trois
             doigts, certains changements de zone visible et la mise en arrière-plan de
             l'onglet. Ce sont des signaux préventifs, pas des preuves de capture : un
             changement d'orientation peut aussi déclencher le masque. Le contenu est
             masqué et une alerte de protection est partagée. Après une interruption,
             le retour à l'application ne révèle pas automatiquement la conversation :
             une reprise explicite est nécessaire. Un bouton bouclier permet aussi
             de masquer le canal volontairement.
          </p>
          <p className="mt-3">
            C'est un <strong>dissuasif, pas un blocage</strong>. Une capture système peut
            se déclencher avant que la page ait eu le temps de réagir, et rien — dans un
            navigateur — ne peut empêcher une photo prise avec un autre appareil ni un
            enregistreur d'écran tiers. Considérez tout ce que vous écrivez comme
            potentiellement photographiable par la personne en face.
          </p>
          <p className="mt-3">
            Les boutons physiques de capture sur iOS et Android ne produisent pas
            d'événement fiable dans une page web. Le masque ne garantit donc ni une
            capture noire, ni une vignette noire dans le sélecteur d'applications.
            Le navigateur ne détecte pas non plus de manière fiable un enregistrement
            d'écran. Aucun message n'est flouté par défaut.
          </p>
        </Section>

        <Section title="Modèle technique">
          <p>
            Chaque salon repose sur un <em>secret aléatoire de 256 bits</em> généré dans
            votre navigateur. Le lien d'invitation le transporte dans le <em>fragment</em>
            de l'URL (après le <code>#</code>), qui n'est envoyé ni au serveur, ni aux
            journaux d'hébergement, ni dans l'en-tête Referer. Le serveur ne reçoit
            qu'un identifiant public, empreinte à sens unique (SHA-256) de ce secret :
            il ne peut pas en déduire la clé. Une clé AES-256-GCM est dérivée du secret via
            PBKDF2 (100 000 itérations) avec un sel aléatoire propre au salon. Tous les
            messages sont chiffrés dans le navigateur avant d'être envoyés. Le serveur
            ne stocke que des cryptogrammes, des vecteurs d'initialisation, des pseudos
            et des empreintes publiques.
          </p>
          <p className="mt-3">
            Votre identité de session est une paire de clés ECDSA P-256 générée localement,
            dont seule l'empreinte publique (16 caractères hex) est partagée. Les messages
            ne sont pas signés : l'empreinte sert d'étiquette, pas de preuve d'identité.
          </p>
        </Section>

        <Section title="Pour des besoins critiques">
          <p>
            CipherRoom est une <strong>expérience</strong> — esthétique, narrative,
            technique. Pour de la confidentialité de niveau professionnel, utilisez{" "}
            <a
              href="https://signal.org"
              className="text-primary glow-amber underline-offset-4 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              Signal
            </a>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="font-mono text-xs text-signal tracking-[0.3em] mb-3 uppercase">
        ▸ {title}
      </h2>
      <div className="text-bone/90 leading-relaxed">{children}</div>
    </section>
  );
}
