
Promise.all([
  d3.json("data/teams.json"),
  d3.json("data/gameweeks.json"),
  d3.json("data/fixtures.json"),
  d3.json("data/config.json")
]).then(([teamsData, gameweeks, fixturesData, config]) => {
  
  // Set gameweek configs
  const activeGW = 20 // config.active_gw; // e.g., "GW3"
  const maxGwNum = 38;
  const numGwsToShow = 5;

}).catch(err => {
  console.error("Error loading data:", err);
});