import { ReactNode } from 'react';

export function Layout(props: {
  sidebar: ReactNode;
  main: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="app">
      {props.sidebar}
      <main className="main">{props.main}</main>
      {props.detail}
    </div>
  );
}
