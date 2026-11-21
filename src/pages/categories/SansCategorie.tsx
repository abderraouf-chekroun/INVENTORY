import { useId, useState, type FormEvent } from 'react';
import { api, type Classement } from '../../api';
import { useAction } from '../../lib/action';
import { nav } from '../../nav';
import { Alert, Etoile, ErrorAlert, MentionObligatoire, useChampsObligatoires } from '../../ui';

/**
 * § 16 (1.7) : aucune catégorie active pour classer un dossier ou un modèle de document (toutes supprimées ou
 * archivées). Comme le formulaire d'employé sans structure (1.5.1) : la catégorie se crée ici, sans quitter la page ni
 * perdre ce qui est déjà saisi, et `onCreee` la reçoit pour la choisir aussitôt. S'il en existe d'archivées, elles se
 * réactivent dans les Paramètres (6.2).
 */
export function SansCategorie({ archivees, pour, onCreee }: {
  /** Nombre de catégories archivées (message « Aucune catégorie active »). */
  archivees: number;
  /** Ce qui doit être classé : « ce dossier » ou « vos modèles ». */
  pour: 'dossier' | 'modele';
  onCreee?: (c: Classement) => void;
}) {
  const id = useId();
  const [nom, setNom] = useState('');
  const creer = useAction((n: string) => api.themeCreer(n), {
    errors: 'local',
    onSuccess: (c) => { setNom(''); onCreee?.(c); },
  });
  const oblig = useChampsObligatoires();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (oblig.verifier(e)) creer.mutate(nom.trim());
  };
  const titre = archivees > 0 ? 'Aucune catégorie active' : 'Aucune catégorie pour l’instant';
  const texte = (pour === 'dossier'
    ? 'Chaque dossier est classé dans une catégorie. Créez-la ici : elle sera choisie pour ce dossier.'
    : 'Chaque modèle de document est classé dans une catégorie. Créez-la ici, puis cliquez sur « Nouveau modèle ».')
    + (archivees > 0 ? ' Pour réactiver une catégorie archivée, ouvrez les Paramètres (section 6.2).' : '');
  return (
    <>
      <Alert tone="warn" title={titre} text={texte}>
        <form className={oblig.classe('saisie-code')} noValidate onSubmit={submit} onInput={oblig.revoir}>
          <label className="saisie-code-lib" htmlFor={id}>Nom de la nouvelle catégorie<Etoile /></label>
          <input className="field sans-categorie-nom" id={id} required autoComplete="off"
            placeholder="Ex. : Support informatique" value={nom}
            onChange={(e) => { setNom(e.target.value); if (creer.error) creer.reset(); }} />
          <button className="btn primary" disabled={creer.isPending}>Créer la catégorie</button>
          {archivees > 0 && (
            <button type="button" className="btn" onClick={() => nav.go({ name: 'parametres' })}>Ouvrir les Paramètres</button>
          )}
          <MentionObligatoire className="inline-mention" />
        </form>
      </Alert>
      <ErrorAlert error={oblig.erreur ?? creer.error} title="Catégorie non créée" />
    </>
  );
}
