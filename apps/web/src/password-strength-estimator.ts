import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";

let engine: ZxcvbnFactory | undefined;
// Only imported by the local Worker and isolated tests. No network, storage or password cache.
export function estimateStrength(password: string, username = "") {
  engine ??= new ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...english.dictionary },
    graphs: common.adjacencyGraphs,
    translations: english.translations,
  });
  return engine.check(password.slice(0, 128), username ? [username] : []).score;
}
