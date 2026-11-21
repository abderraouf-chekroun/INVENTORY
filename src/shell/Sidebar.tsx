import { Fragment } from 'react';
import { NAV, nav, type NavId } from '../nav';
import { Icon } from '../ui/Icon';

/**
 * Barre latérale : six entrées ; « Création » et « Paramètres » sont poussées en bas. Depuis la 1.8 (§ 17), leurs
 * numéros 1 à 6 ne s'affichent plus (ils ne correspondaient à aucun raccourci clavier).
 */
export function Sidebar({ current }: { current: NavId | null }) {
  return (
    <nav className="side" aria-label="Navigation principale">
      {NAV.map((n, i) => (
        <Fragment key={n.id}>
          {i === 4 && <><span className="grow" /><hr /></>}
          <button type="button" className="nav" aria-current={n.id === current ? 'page' : undefined} title={n.label}
            onClick={() => nav.root(n.route)}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
