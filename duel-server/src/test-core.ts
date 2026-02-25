import createCore, { OcgDuelMode } from "@n1xx1/ocgcore-wasm";

async function main() {
  console.log("Loading OCGCore WASM...");
  const core = await createCore({ sync: true });
  console.log("OCGCore loaded successfully!");

  const version = core.getVersion();
  console.log(`OCGCore version: ${version[0]}.${version[1]}`);

  // Try creating a minimal duel (no cards, just validate the API works)
  const duel = core.createDuel({
    flags: OcgDuelMode.MODE_MR5,
    seed: [1n, 2n, 3n, 4n],
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader: (code: number) => {
      console.log(`  cardReader called for card: ${code}`);
      return null;
    },
    scriptReader: (name: string) => {
      console.log(`  scriptReader called for: ${name}`);
      return null;
    },
    errorHandler: (type, text) => {
      console.log(`  [OCG Error] ${type}: ${text}`);
    },
  });

  if (duel) {
    console.log("Duel created successfully!");
    core.destroyDuel(duel);
    console.log("Duel destroyed.");
  } else {
    console.error("Failed to create duel.");
  }

  console.log("\nPoC Step 1 PASSED: Core loads and creates duel in Node.js");
}

main().catch(console.error);
