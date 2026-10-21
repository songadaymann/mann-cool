// The lab's games, newest first, with the ones open to everyone ahead of the crypto ones. Crypto
// games only show once the wallet gate finds a wallet, so they arrive at the end of the grid and
// the cards already on screen stay where they are.
export function labGames(games) {
  return games
    .filter((game) => game.status === "lab")
    .sort((a, b) => Number(Boolean(a.crypto)) - Number(Boolean(b.crypto)) || b.catalogOrder - a.catalogOrder);
}

// The lab games this visitor can see. hasWallet is null until the wallet gate answers, and crypto
// games need a yes.
export function visibleLabGames(games, hasWallet) {
  return labGames(games).filter((game) => !game.crypto || hasWallet === true);
}
