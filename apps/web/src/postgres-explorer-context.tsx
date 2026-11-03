import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import type { ReactNode } from "react";

export type PostgresProof = {
  ticket: string;
  database: string;
  account: string;
  endpoint: string;
};
type ExplorerState = {
  proof: PostgresProof | null;
  open: (proof: PostgresProof) => void;
  clear: () => void;
};
const Context = createContext<ExplorerState | null>(null);

export function PostgresExplorerProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [proof, setProof] = useState<PostgresProof | null>(null);
  const clear = useCallback(() => setProof(null), []);
  const value = useMemo(
    () => ({ proof, open: setProof, clear }),
    [proof, clear],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePostgresExplorer() {
  const value = useContext(Context);
  if (!value) throw new Error("PostgreSQL浏览上下文缺失");
  return value;
}
