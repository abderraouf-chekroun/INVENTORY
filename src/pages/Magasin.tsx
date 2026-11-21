import { api, type MotCleMagasin } from '../api';
import { messageSuppressionMotCle, nbDocumentsDe, nbDocumentsLabel } from '../lib/magasin';
import { useMagasin } from '../lib/queries';
import type { PageProps } from '../nav';
import { ClassementList, PageHeader, QueryView, Section } from '../ui';

/** « 2 mots-clés actifs », « 1 mot-clé actif », « 0 mot-clé actif ». */
const activeCount = (n: number) => (n > 1 ? `${n} mots-clés actifs` : `${n} mot-clé actif`);

/**
 * Module 5 · Magasin (section 5.7) : mots-clés proposés dans les blocs « Choix du Magasin ». Depuis la 1.8 (§ 17), un
 * mot-clé se renomme (les documents qui l'avaient choisi affichent le nouveau nom) et se supprime (les documents
 * gardent la valeur écrite), comme les catégories.
 */
export default function Magasin(_props: PageProps<'magasin'>) {
  const magasin = useMagasin();
  const actifs = magasin.data?.filter((x) => x.actif).length;
  return (
    <>
      <PageHeader title="Magasin"
        lead="Les mots-clés du Magasin sont proposés dans les champs « Choix du Magasin » quand vous remplissez un fichier." />
      <Section num="5.7" title="Mots-clés du Magasin"
        extra={actifs !== undefined && <span className="cnt">{activeCount(actifs)}</span>}>
        <QueryView query={magasin}>
          {(items) => (
            <ClassementList<MotCleMagasin> items={items} icon="magasin" primary
              toggle={(id) => api.magasinBasculer(id)} create={(nom) => api.magasinCreer(nom)}
              rename={(id, nom) => api.magasinRenommer(id, nom)}
              detail={(k) => nbDocumentsLabel(nbDocumentsDe(k))}
              remove={{
                action: (id) => api.magasinSupprimer(id),
                titre: (k) => `Supprimer le mot-clé « ${k.nom} » ?`,
                message: (k) => messageSuppressionMotCle(nbDocumentsDe(k)),
                motifImpossible: () => null,
              }}
              placeholder="Nouveau mot-clé" submitLabel="Ajouter au Magasin" empty="Aucun mot-clé pour l’instant." />
          )}
        </QueryView>
      </Section>
    </>
  );
}
