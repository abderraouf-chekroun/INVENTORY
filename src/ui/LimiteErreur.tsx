import { Component, type ErrorInfo, type ReactNode } from 'react';
import { nav, useNav } from '../nav/store';
import { Alert } from './Alert';

interface Props {
  /** Change à chaque changement de page ou de route : l'erreur est alors oubliée et la page retentée. */
  resetKey: unknown;
  children: ReactNode;
}

interface State {
  error: boolean;
  cle: unknown;
}

/**
 * Limite d'erreur autour du rendu d'une page : une erreur de rendu (donnée inattendue) n'emporte pas
 * toute l'application. La barre de titre, la barre latérale et la recherche restent en place,
 * avec un message lisible et un moyen de revenir.
 */
export class LimiteErreur extends Component<Props, State> {
  state: State = { error: false, cle: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { error: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.cle ? { error: false, cle: props.resetKey } : null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Erreur de rendu de la page', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const peutRevenir = useNav.getState().stack.length > 0;
    return (
      <Alert tone="bad" title="Cette page n’a pas pu s’afficher"
        text="Une donnée inattendue empêche son affichage. Le reste de l’application fonctionne normalement.">
        <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {peutRevenir && <button type="button" className="btn" onClick={() => nav.back()}>Revenir à la page précédente</button>}
          <button type="button" className="btn" onClick={() => nav.root({ name: 'dashboard' })}>Ouvrir le tableau de bord</button>
        </span>
      </Alert>
    );
  }
}
