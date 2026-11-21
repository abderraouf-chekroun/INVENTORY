import { nav, type PageProps, type Route } from '../nav';
import { HubCard, PageHeader, Section, type IconName } from '../ui';

const CARDS: readonly { to: Route; icon: IconName; title: string; text: string; cta: string }[] = [
  { to: { name: 'form-entite', kind: 'a' }, icon: 'a', title: 'Créer un employé', text: 'Nom, prénom, date de naissance, poste et structure. L’identifiant est attribué automatiquement.', cta: 'Ouvrir le formulaire' },
  { to: { name: 'form-entite', kind: 'b' }, icon: 'b', title: 'Créer une machine', text: 'PC ou portable : identifiant, marque et modèle, processeur, RAM et stockage.', cta: 'Ouvrir le formulaire' },
  { to: { name: 'form-dossier' }, icon: 'dossier', title: 'Créer un dossier', text: 'Nom, année et catégorie. Ouvert en pleine page, prêt à recevoir ses documents.', cta: 'Ouvrir le formulaire' },
  { to: { name: 'studio' }, icon: 'fichier', title: 'Modèles de document', text: 'Les formulaires standards, et vos propres modèles composés de champs personnalisés.', cta: 'Ouvrir le Studio de Modèles' },
  { to: { name: 'magasin' }, icon: 'magasin', title: 'Magasin', text: 'Mots-clés à choisir quand vous remplissez un fichier.', cta: 'Ouvrir le Magasin' },
];

/** Module 5 · Création (section 5.1) : les 4 cartes du prototype + « Créer un dossier ». */
export default function Creation(_props: PageProps<'creation'>) {
  return (
    <>
      <PageHeader title="Création"
        lead="Créer un employé, une machine ou un dossier, gérer les modèles de document ou tenir le Magasin de mots-clés. Chaque entrée s’ouvre en pleine page." />
      <Section num="5.1" title="Que voulez-vous créer ?">
        <div className="hub">
          {CARDS.map((c) => (
            <HubCard key={c.title} icon={c.icon} title={c.title} text={c.text} cta={c.cta} onClick={() => nav.go(c.to)} />
          ))}
        </div>
      </Section>
    </>
  );
}
