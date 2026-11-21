import { Fragment } from 'react';
import { nav, useNav } from '../nav';
import { Icon } from '../ui/Icon';
import type { ShellCrumb } from './chrome';
import { GlobalSearch } from './GlobalSearch';

function Breadcrumbs({ crumbs }: { crumbs: ShellCrumb[] }) {
  return (
    <nav className="crumbs" aria-label="Fil d’Ariane">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        const to = c.to;
        return (
          <Fragment key={i}>
            {i > 0 && <Icon name="right" size={12} />}
            {last || !to ? (
              <b aria-current={last ? 'page' : undefined}>{c.label}</b>
            ) : (
              <button type="button" onClick={() => (c.root ? nav.root(to) : nav.go(to))}>{c.label}</button>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

/** Barre du haut : Retour, fil d'Ariane cliquable, recherche globale. */
export function TopBar({ crumbs }: { crumbs: ShellCrumb[] }) {
  const canGoBack = useNav((s) => s.stack.length > 0);
  return (
    <div className="topbar">
      <button type="button" className="btn" title="Retour (Alt + ←)" disabled={!canGoBack} onClick={() => nav.back()}>
        <Icon name="back" />
        <span className="backl">Retour</span>
      </button>
      <span className="vr" />
      <Breadcrumbs crumbs={crumbs} />
      <GlobalSearch />
    </div>
  );
}
