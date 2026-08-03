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
            <li>Votre identité : aucune inscription, pseudo généré, clés en mémoire de session.</li>
            <li>L'historique : les salons et messages s'auto-effacent à expiration.</li>
          </ul>
        </Section>

        <Section title="Ce que CipherRoom ne protège pas">
          <ul className="space-y-2 list-disc list-inside">
            <li>Quelqu'un qui regarde votre écran ou capture votre fenêtre.</li>
            <li>Un appareil compromis (malware, keylogger).</li>
            <li>Le partage du lien d'invitation à un tiers — quiconque l'a peut entrer.</li>
            <li>Le Perfect Forward Secrecy avancé (Signal le fait, pas nous).</li>
          </ul>
        </Section>

        <Section title="Modèle technique">
          <p>
            Chaque salon est identifié par un UUID v4 servant de <em>secret partagé</em> :
            le lien d'invitation contient ce secret. Une clé AES-256-GCM est dérivée de ce
            secret via PBKDF2 (100 000 itérations). Tous les messages sont chiffrés dans le
            navigateur avant d'être envoyés. Le serveur ne stocke que des cryptogrammes,
            des vecteurs d'initialisation et des empreintes publiques.
          </p>
          <p className="mt-3">
            Votre identité de session est une paire de clés ECDSA P-256 générée localement.
            L'empreinte publique (16 caractères hex) est partagée pour vérification entre
            participants.
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
