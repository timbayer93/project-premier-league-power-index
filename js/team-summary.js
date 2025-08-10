// Promise.all([
//   d3.json("data/d3_team_ratings.json"), // contains: { code, spi, off, def, ... }
//   d3.json("data/d3_teams.json")         // contains: { code, name, abbr, ... }
// ]).then(([ratings, teams]) => {

//   // Convert teams array to lookup for quick matching
//   const teamLookup = {};
//   teams.forEach(t => {
//     teamLookup[t.team_code] = t; // t.code is the join key
//   });

//   // Merge ratings + team info
//   const mergedData = ratings.map(r => ({
//     ...r,
//     ...teamLookup[r.team_code]
//   }));

//   // Create colour scale for SPI strength
//   const spiExtent = d3.extent(mergedData, d => d.spi);
//   const strengthScale = d3.scaleLinear()
//     .domain(spiExtent) // min & max SPI values
//     .range(["#d73027", "#1a9850"]); // red to green

//   // Create a diverging scale with median in the middle
//   const colorScale = d3.scaleDiverging()
//     .domain([40, 55, 70])  // // shift scale slightly towards green
//     .interpolator(customDivergingInterpolatorGreenPurple)


//   // Sort descending by SPI
//   mergedData.sort((a, b) => d3.descending(a.spi, b.spi));


//   // Append team cards
//   const container = d3.select("#team-summary");

//   container.selectAll(".team-card")
//     .data(mergedData)
//     .enter()
//     .append("div")
//     .attr("class", "team-card")
//     .style("background-color", d => colorScale(d.spi))
//     .text(d => `${d.team_short}`); // from teams.json

// }).catch(err => {
//   console.error("Error loading team data:", err);
// });


Promise.all([
  d3.json("data/d3_team_ratings.json"), // { code, spi, off, def }
  d3.json("data/d3_teams.json")         // { code, team_short }
]).then(([ratings, teams]) => {

  const teamLookup = {};
  teams.forEach(t => teamLookup[t.team_code] = t);

  const mergedData = ratings.map(r => ({
    ...r,
    ...teamLookup[r.team_code]
  }));

  const eloValues = mergedData.map(d => d.spi);

  const eloMin = d3.min(eloValues);
  const eloMax = d3.max(eloValues);
  const eloMean = d3.mean(eloValues);
  const eloMedian = d3.median(eloValues);
  const elo10th = d3.quantile(eloValues, 0.1);
  const elo90th = d3.quantile(eloValues, 0.9);
  // console.log(eloMin)
  // console.log(eloMax)
  // console.log(eloMean)
  // console.log(eloMedian)
  // console.log(elo10th)
  // console.log(elo90th)

  // Sort by SPI
  mergedData.sort((a, b) => d3.descending(a.spi, b.spi));

  // Create a diverging scale with median in the middle
  const colorScale = d3.scaleDiverging()
    .domain([elo10th, eloMedian, elo90th])  // // shift scale slightly towards green
    .interpolator(customDivergingInterpolatorGreenPurple)

  const container = d3.select("#team-card-list");

  const cards = container.selectAll(".team-card")
    .data(mergedData)
    .enter()
    .append("div")
    .attr("class", "team-card");

  // Add rank badge
  cards.append("div")
    .attr("class", "rank-badge")
    .text((d, i) => `#${i + 1}`); // i+1 because 0-based index after sorting

  // Header row (logo + name)
  const header = cards.append("div")
    .attr("class", "team-card-header");

  header.append("img")
    .attr("src", d => getTeamLogoURL(d.team_code))
    .attr("alt", d => d.team_short);

  header.append("div")
    .attr("class", "team-short")
    .text(d => d.team_short);

  // Stats rows
  // cards.append("div")
  //   .attr("class", "stat-row")
  //   .html(d => `<span class="stat-label">PPI</span><span class="stat-value">${d.spi.toFixed(1)}</span>`);
  cards.append("div")
    .attr("class", "stat-row")
    .html(d => {
      const bgColor = colorScale(d.spi);
      const txtColor = getTextColor(colorScale(d.spi))
      return `<span class="stat-label">PPI</span><span class="stat-value" style="background-color:${bgColor}; color:${txtColor};">${d.spi.toFixed(1)}</span>`;
    });

  cards.append("div")
    .attr("class", "stat-row")
    .html(d => `<span class="stat-label">OFF</span><span class="stat-value">${d.off_rating.toFixed(2)}</span>`);

  cards.append("div")
    .attr("class", "stat-row")
    .html(d => `<span class="stat-label">DEF</span><span class="stat-value">${d.def_rating.toFixed(2)}</span>`);

  // Scroll buttons
  const scrollAmount = 200; // adjust per click
  document.getElementById("scroll-left").addEventListener("click", () => {
    document.getElementById("team-card-list").scrollBy({ left: -scrollAmount, behavior: 'smooth' });
  });
  document.getElementById("scroll-right").addEventListener("click", () => {
    document.getElementById("team-card-list").scrollBy({ left: scrollAmount, behavior: 'smooth' });
  });

}).catch(err => {
  console.error("Error loading team data:", err);
});

