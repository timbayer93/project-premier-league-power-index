Promise.all([
  d3.json("data/d3_teams.json"),
  d3.json("data/d3_match_forecasts.json"),
  d3.json("data/d3_team_ratings.json"),
  d3.json("data/d3_config.json")
]).then(([teamInfo, matchForecasts, teamRatings, config]) => {

  const teamMap = new Map(teamInfo.map(d => [d.team_code, d]));
  const ratingMap = new Map(teamRatings.map(d => [d.team_code, d]));

  const teamFixturesMap = new Map();
  matchForecasts.forEach(fixture => {
    const addFixture = (team_code, opponent_code, fixture_id, gwId, xg_for, xg_against, cs_prob, is_home) => {
      if (!teamFixturesMap.has(team_code)) {
        teamFixturesMap.set(team_code, {
          team_code,
          fixtures: []
        });
      }
      teamFixturesMap.get(team_code).fixtures.push({
        fixture_id,
        gwId,
        opponent_code,
        xg_for,
        xg_against,
        cs_prob,
        is_home
      });
    };
    addFixture(fixture.home_team_code, fixture.away_team_code, fixture.fixture_id, fixture.gw, fixture.home_xg, fixture.away_xg, fixture.away_goals_0_prob, "H");
    addFixture(fixture.away_team_code, fixture.home_team_code, fixture.fixture_id, fixture.gw, fixture.away_xg, fixture.home_xg, fixture.home_goals_0_prob, "A");
  });

  // Initalize Sort Order
  let currentSort = { column: null, ascending: false };
  
  // Select the viz container
  const container = d3.select(".fixture-xg-table-container");

  // Set tooltips
  const tooltip = d3.select(".xg-table-tooltip");

  // Hide tooltip on scroll or outside click
  document.addEventListener("scroll", () => tooltip.style("display", "none"));
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".fixture-xg-table__header-gw") &&
        !e.target.closest(".fixture-xg-table__header--metric")) {
      tooltip.style("display", "none");
    }
  });

  let tooltipTimeout;
  function showTooltip(content, x, y) {
    const tooltipNode = tooltip.node();
    tooltip.html(content).style("display", "block");

    // Temporarily position offscreen to measure size
    tooltip.style("left", "-9999px").style("top", "-9999px");

    const tooltipWidth = tooltipNode.offsetWidth;
    const tooltipHeight = tooltipNode.offsetHeight;
    const padding = 10; // some space from cursor

    const pageWidth = window.innerWidth;
    const pageHeight = window.innerHeight;

    // Calculate horizontal position
    let left;
    if (x + tooltipWidth + padding > pageWidth) {
      // place to the left
      left = x - tooltipWidth - padding;
    } else {
      // place to the right
      left = x + padding;
    }

    // Calculate vertical position (stay inside viewport vertically)
    let top = y + padding;
    if (top + tooltipHeight > pageHeight) {
      top = y - tooltipHeight - padding;
    }
    if (top < 0) top = 0;

    tooltip.style("left", `${left}px`).style("top", `${top}px`);

    // clear previous timeout and set new one ---
    if (tooltipTimeout) clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => {
      tooltip.style("display", "none");
      tooltipTimeout = null;
    }, 2000); // hide after 2 seconds
  }


  function hideTooltip() {
    tooltip.style("display", "none");
  }

  // Dynamic setup
  function getUserInputs() {
    const activeGWInput = document.getElementById("active-gw-input-copy");
    const numGWsInput = document.getElementById("num-gws-input-copy");
    const activeGW = activeGWInput?.value ? parseInt(activeGWInput.value, 10) : config.active_gw + 1;
    // const activeGW = 26
    const numGWs = numGWsInput?.value ? parseInt(numGWsInput.value, 10) : 5;
    const compactToggle = document.getElementById("compact-toggle-copy").checked;
    // const metric_type = "attack";

    const activeToggle = document.querySelector('#metric-selector-toggle .toggle-option.active');
    const metric_type = activeToggle?.getAttribute('data-value') || 'attack';
    return { activeGW, numGWs, compactToggle , metric_type };
  }

  function getGameweeksToShow(activeGW, numGWs) {
    return Array.from({ length: numGWs }, (_, i) => activeGW + i);
  }

  function computeTeamMetrics(teamsMap, gameweeks, metricType) {
    const teams = Array.from(teamsMap.values()).map(team => {
      const relevantFixtures = team.fixtures.filter(f => gameweeks.includes(f.gwId));
      const total_metric = relevantFixtures.reduce((sum, f) =>
        sum + (metricType === "attack" ? f.xg_for : f.cs_prob), 0);
      return { ...team, total_metric, fixtures_by_gw: d3.group(team.fixtures, d => d.gwId) };
    });
    return teams.sort((a, b) => b.total_metric - a.total_metric);
  }

  function createColorScale(metricType) {
    return d3.scaleLinear()
      .domain(metricType === "attack" ? [0.95, 3] : [0.3, 0.6])
      .range(["#fff", metricType === "attack" ? COLORS.blue : COLORS.pink])
      .clamp(true);
  }

  // Render Table
  function renderTable(teams, gameweeks, metricType, colorScale, compact) {
    container.selectAll("*").remove(); // Clear previous

    const table = container.append("table").attr("class", "fixture-xg-table");
    const thead = table.append("thead").append("tr");
    const tbody = table.append("tbody");
    

    // HEADERS
    const outsideHeader = document.querySelector(".fixture-xg-gameweeks-label");
    outsideHeader.classList.toggle("compact", compact);
    
    if (outsideHeader) {
      if (metricType === 'attack') {
        outsideHeader.textContent = 'EXPECTED GOALS PER GW';
      } else {
        outsideHeader.textContent = 'CLEAN SHEET PROBABILITY (%) PER GW';
      }
    } 

    const staticHeaders = ["#", "TEAM", metricType === "attack" ? "xG" : "xCS"];
    const staticHeaderMap = new Map();
    const gwHeaderMap = new Map();

    staticHeaders.forEach(header => {
      const classMap = {
        "#": "fixture-xg-table__header--rank sticky-header--0",
        "TEAM": `fixture-xg-table__header--team sticky-header--1${compact ? ' compact' : ''}`,
        "xG": `fixture-xg-table__header--metric sticky-header--2${compact ? ' compact' : ''}`,
        "xCS": `fixture-xg-table__header--metric sticky-header--2${compact ? ' compact' : ''}`
      };

      const th = thead.append("th")
        .attr("class", classMap[header])
        .style("cursor", "pointer")
        .text(header)
        .on("click", () => sortTableByColumn(header, teams, metricType, gameweeks, colorScale, tbody, compact, staticHeaderMap, gwHeaderMap));
      staticHeaderMap.set(header, th);
    });

    gameweeks.forEach(gw => {
      const label = `GW${gw}`;
      const th = thead.append("th")
        .attr("class", "fixture-xg-table__header-gw")
        .style("cursor", "pointer")
        .text(label)
        .on("click", () => sortTableByColumn(label, teams, metricType, gameweeks, colorScale, tbody, compact, staticHeaderMap, gwHeaderMap));
      gwHeaderMap.set(label, th);
    });

    updateTableBody(teams, gameweeks, metricType, colorScale, tbody, compact);
  }

  // Update body
  function updateTableBody(teams, gameweeks, metricType, colorScale, tbody, compact) {
    tbody.selectAll("tr").remove();

    // check if we have any DGWs coming to help with styling
    const anyDoubleGameweeks = teams.some(team =>
      gameweeks.some(gw =>
        team.fixtures_by_gw?.get(gw)?.length > 1
      )
    );

    // const anyDoubleGameweeks = false

    teams.forEach((team, index) => {
      const row = tbody.append("tr").attr("class", "fixture-xg-table__row");

      // Rank column
      row.append("td")
        .attr("class", "fixture-xg-table__cell fixture-xg-table__cell--rank fixture-xg-table__cell--sticky fixture-xg-table_rank-col--sticky")
        .text(`${index + 1}.`);

      // Team column
      const teamInfo = teamMap.get(team.team_code);
      const ratings = ratingMap.get(team.team_code);

      const teamCell = row.append("td").attr("class", `fixture-xg-table__cell fixture-xg-table__cell--team${compact ? ' compact' : ''} fixture-xg-table__cell--sticky fixture-xg-table_team-col--sticky`);
      const teamRow = teamCell.append("div").attr("class", `fixture-xg-table__col--team`);

      teamRow.append("img")
        .attr("src", getTeamLogoURL(team.team_code))
        .attr("alt", teamInfo.team_short)
        .attr("class", "fixture-xg-table__team-logo");

      teamRow.append("span")
        .attr("class", "fixture-xg-table__team-name")
        .text(teamInfo.team_short);

      // teamCell.append("div")
      //   .attr("class", "fixture-xg-table__team-meta")
      //   .text(`OFF: ${ratings.off_rating.toFixed(2)} | DEF: ${ratings.def_rating.toFixed(2)}`);

      if (!compact) {
        teamCell.append("div")
          .attr("class", "fixture-xg-table__team-meta")
          .text(`OFF: ${ratings.off_rating.toFixed(2)} | DEF: ${ratings.def_rating.toFixed(2)}`);
      }


      // Metric Column (Total)
      row.append("td")
        .attr("class", `fixture-xg-table__col--metric${compact ? ' compact' : ''} fixture-xg-table__cell fixture-xg-table__cell--sticky fixture-xg-table_metric-col--sticky`)  
        // .style("background-color", colorScale(team.total_metric))
        // .style("color", getTextColor(colorScale(team.total_metric)))
        // .style("font-weight", "bold")
        .text(team.total_metric.toFixed(1));


      // FILL GW CELLS
      gameweeks.forEach(gw => {
        const cell = row.append("td").attr("class", `fixture-xg-table__cell--fixture${compact ? ' compact' : ''}`);
        const fixtures = team.fixtures_by_gw.get(gw) || [];
        
        // set line height for styling the table
        let lineHeight;
        if (compact && anyDoubleGameweeks) {
          lineHeight = 35;
        } else if (compact) {
          lineHeight = 20;
        } else if (anyDoubleGameweeks) {
          lineHeight = 35;
        } else {
          lineHeight = 25;
        }

        // Plot each fixture (check for DGWs)
        if (fixtures.length === 0) {
          cell.text("-").style("text-align", "center");
        } else {
          fixtures.forEach((f, i) => {
            const value = metricType === "attack" ? f.xg_for : f.cs_prob;
            const opponent = teamMap.get(f.opponent_code);

            const tooltipText = `<strong>GW ${f.gwId} | vs. ${opponent.team_short} (${f.is_home})</strong><br>` +
              (metricType === "attack"
                ? `Expected Goals: <strong>${value.toFixed(2)}</strong>`
                : `Clean Sheet Probability: <strong>${Math.round(value * 100)}%</strong>`
              );
            let touchTimeout;

            cell.append("div")
              .attr("class", "fixture-xg-table__fixture-box")
              .style("padding", `${2 / fixtures.length}px 0`)  // top and bottom padding
              .style("line-height", `${lineHeight / fixtures.length}px`)
              .style("margin-bottom", i < fixtures.length - 1 ? "1px" : "0") // DG: vertical space between boxes
              .style("background-color", colorScale(value))
              .style("color", getTextColor(colorScale(value)))
              .text(metricType === "attack" 
                ? value.toFixed(2) 
                : `${Math.round(value * 100)}%`
              )
              .on("mouseover", (event) => {
                showTooltip(tooltipText, event.pageX, event.pageY);
              })
              .on("mousemove", (event) => {
                showTooltip(tooltipText, event.pageX, event.pageY);
              })
              .on("mouseout", hideTooltip)
              .on("touchstart", (event) => {
                event.preventDefault();
                touchTimeout = setTimeout(() => {
                  showTooltip(tooltipText, event.touches[0].pageX, event.touches[0].pageY);
                }, 300)
              .on("touchmove", () => {
                clearTimeout(touchTimeout); // cancel tooltip if user is scrolling
                hideTooltip();
              })
              .on("touchend", () => {
                clearTimeout(touchTimeout); // clean up timeout on touch end
              });
              });
          });
        }
      });
    });
  }

  // Sort and rerender
  function sortTableByColumn(headerLabel, teams, metricType, gameweeks, colorScale, tbody, compact, staticHeaderMap, gwHeaderMap) {
    const isGW = headerLabel.startsWith("GW");
    const ascending = currentSort.column === headerLabel ? !currentSort.ascending : false;
    currentSort = { column: headerLabel, ascending };

    const sorted = teams.sort((a, b) => {
      let aVal, bVal;
      if (isGW) {
        const gw = +headerLabel.replace("GW", "");
        aVal = d3.sum(a.fixtures_by_gw.get(gw) || [], d => metricType === "attack" ? d.xg_for : d.cs_prob);
        bVal = d3.sum(b.fixtures_by_gw.get(gw) || [], d => metricType === "attack" ? d.xg_for : d.cs_prob);
      } else {
        switch (headerLabel) {
          case "#": aVal = a.rank; bVal = b.rank; break;
          case "TEAM": aVal = teamMap.get(a.team_code)?.team_short; bVal = teamMap.get(b.team_code)?.team_short; break;
          case "xG":
          case "xCS": aVal = a.total_metric; bVal = b.total_metric; break;
          default: aVal = 0; bVal = 0;
        }
      }
      return ascending ? d3.ascending(aVal, bVal) : d3.descending(aVal, bVal);
    });

    staticHeaderMap.forEach((th, label) => {
      const arrow = label === headerLabel ? (ascending ? "↑ " : "↓ ") : "";
      th.text(arrow + label);
    });

    gwHeaderMap.forEach((th, label) => {
      const arrow = label === headerLabel ? (ascending ? "↑ " : "↓ ") : "";
      th.text(arrow + label);
    });

    updateTableBody(sorted, gameweeks, metricType, colorScale, tbody, compact);
  }

  // Initial draw
  function drawFixtureXGTable() {
    const { activeGW, numGWs, compactToggle, metric_type} = getUserInputs();
    const GAMEWEEKS_TO_SHOW = getGameweeksToShow(activeGW, numGWs);
    const colorScale = createColorScale(metric_type);
    const teams = computeTeamMetrics(teamFixturesMap, GAMEWEEKS_TO_SHOW, metric_type);
    renderTable(teams, GAMEWEEKS_TO_SHOW, metric_type, colorScale, compactToggle);
  }

  // Re-init when inputs change
  document.getElementById("active-gw-input-copy").addEventListener("change", drawFixtureXGTable);
  document.getElementById("num-gws-input-copy").addEventListener("change", drawFixtureXGTable);
  document.getElementById("compact-toggle-copy").addEventListener("change", drawFixtureXGTable);
  
  // User input syncs
  window.addEventListener("activeGwUpdated", (e) => {
    drawFixtureXGTable();
  });
  window.addEventListener("numGwsUpdated", (e) => {
    renderTickerChart();
  });

  drawFixtureXGTable(); // initial run

  // Attack / Defense Toggle
  const toggle = d3.select('#metric-selector-toggle');
  const options = toggle.selectAll('.toggle-option');

  // Initial state
  let selected = "attack";
  options
    .filter(function() {
      return d3.select(this).attr('data-value') === selected;
    })
    .classed('active', true);


  // Add click event
  options.on('click', function(event) {
    const selectedValue = d3.select(this).attr('data-value');
    // Update visual
    options.classed('active', false);
    d3.select(this).classed('active', true);

    // Feed selected value into your chart logic
    drawFixtureXGTable();
  });

});










// Promise.all([
//   d3.json("data/d3_teams.json"),
//   d3.json("data/d3_match_forecasts.json"),
//   d3.json("data/d3_team_ratings.json"),
//   d3.json("data/d3_config.json")
// ]).then(([teamInfo, matchForecasts, teamRatings, config]) => {

//   // Load user inputs
//   const activeGWInput = document.getElementById('activeGW');
//   let activeGW;
//   if (activeGWInput && activeGWInput.value !== "") {
//     activeGW = parseInt(activeGWInput.value, 10);
//   } else {
//     // fall back to config json (first load)
//     activeGW = config.active_gw + 1;
//   }
//   const numGWs = parseInt(document.getElementById('num-gws').value, 10);

//   // Set which gameweeks to show
//   // const GAMEWEEKS_TO_SHOW = [1, 2, 3, 4, 5, 6];
//   const GAMEWEEKS_TO_SHOW = Array.from(
//     { length: numGWs },
//     (_, i) => activeGW + i
//   );

//   // Set Metrix type
//   const METRIC_TYPE = "attack"; // or "defence"

//   // Initalize Column Sort
//   let currentSort = { column: null, ascending: false };

//   // Team Lookup
//   const teamMap = new Map(teamInfo.map(d => [d.team_code, d]));
//   const ratingMap = new Map(teamRatings.map(d => [d.team_code, d]));

//   // Group fixtures by team
//   const teamFixturesMap = new Map();
//   matchForecasts.forEach(fixture => {
//     const addFixture = (team_code, opponent_code, fixture_id, gwId, xg_for, xg_against, cs_prob) => {
//       if (!teamFixturesMap.has(team_code)) {
//         teamFixturesMap.set(team_code, {
//           team_code,
//           fixtures: [],
//           // ...ratingMap.get(team_code) || { off: null, def: null }
//         });
//       }
//       teamFixturesMap.get(team_code).fixtures.push({ 
//         fixture_id, 
//         gwId,
//         opponent_code,
//         xg_for, 
//         xg_against,
//         cs_prob
//       });
//     };

//     addFixture(fixture.home_team_code, fixture.away_team_code, fixture.fixture_id, fixture.gw, fixture.home_xg, fixture.away_xg, fixture.away_goals_0_prob);
//     addFixture(fixture.away_team_code, fixture.home_team_code, fixture.fixture_id, fixture.gw, fixture.away_xg, fixture.home_xg, fixture.home_goals_0_prob);
//   });

//   // console.log(teamMap)
//   // console.log(ratingMap)
//   // console.log(teamFixturesMap)

//   // -------- VIZ  --------- //

//   // Calculate total xG for
//   // console.log(teamFixturesMap)
//   // const teams = Array.from(teamFixturesMap.values()).map(team => {
//   //   team.total_xg = team.fixtures.reduce((sum, fixture) => sum + fixture.xg_for, 0);
//   //   team.total_cs = team.fixtures.reduce((sum, fixture) => sum + fixture.cs_prob, 0);
//   //   return team;
//   // });
//   const teams = Array.from(teamFixturesMap.values()).map(team => {
//   const relevantFixtures = team.fixtures.filter(fixture =>
//     GAMEWEEKS_TO_SHOW.includes(fixture.gwId)
//     );

//     if (METRIC_TYPE === "attack") {
//       team.total_metric = relevantFixtures.reduce((sum, f) => sum + f.xg_for, 0);
//     } else {
//       team.total_metric = relevantFixtures.reduce((sum, f) => sum + f.cs_prob, 0);
//     }
//     return team;
//   });


//   teams.sort((a, b) => b.total_metric - a.total_metric);

//   let colorScale;
//   if (METRIC_TYPE === "attack") {
//     colorScale = d3.scaleLinear()
//       .domain([.95, 3])
//       .range(["#fff", COLORS.pink])
//       .clamp(true);
//   } else {
//     colorScale = d3.scaleLinear()
//       .domain([.3, .6])
//       .range(["#fff", COLORS.pink]);
//   }


//   // Render table with D3
//   const container = d3.select(".fixture-xg-table-container");
//   const table = container.append("table").attr("class", "fixture-xg-table");

//   // Table headers
//   const thead = table.append("thead").append("tr");
//   const staticHeaderMap = new Map();
//   // const staticHeaders = ["#", "Team", "xG"];  
//   const staticHeaders = ["#", "Team", METRIC_TYPE === "attack" ? "xG" : "xCS"];


//   // thead.append("th")
//   //   .attr("class", `fixture-xg-table__header--rank sticky-header--0`)
//   //   .text("#")
//   //   .style("cursor", "pointer")
//   //   .on("click", () => sortTableByColumn("#"));

//   // thead.append("th")
//   //   .attr("class", `fixture-xg-table__header--team sticky-header--1`)
//   //   .text("Team".toUpperCase())
//   //   .style("cursor", "pointer")
//   //   .on("click", () => sortTableByColumn("Team"));

//   // thead.append("th")
//   //   .attr("class", `fixture-xg-table__header--metric sticky-header--2`)
//   //   .text("(xG)".toUpperCase())
//   //   .style("cursor", "pointer")
//   //   .on("click", () => sortTableByColumn("xG_For"));

//   // const staticHeaders = ["#", "Team", "Expected Goals (xG)"];
//   staticHeaders.forEach(header => {
//     const classMap = {
//       "#": "fixture-xg-table__header--rank sticky-header--0",
//       "Team": "fixture-xg-table__header--team sticky-header--1",
//       "xG": "fixture-xg-table__header--metric sticky-header--2"
//     };

//     const th = thead.append("th")
//       .attr("class", classMap[header])
//       .style("cursor", "pointer")
//       .on("click", () => sortTableByColumn(header));

//     staticHeaderMap.set(header, th);
//   });

//   const scrollableHeaders = [...GAMEWEEKS_TO_SHOW.map(gw => `GW${gw}`)];
//   // stickyHeaders.forEach((header, index) => thead.append("th").attr("class", `sticky-header--${index}`).text(header));
//   // scrollableHeaders.forEach((header, i) => {
//   //   thead.append("th")
//   //     .text(header)
//   //     .style("cursor", "pointer")
//   //     .on("click", () => sortTableByColumn(header));
//   // });

//   const gwHeaderMap = new Map();

//   scrollableHeaders.forEach((header, i) => {
//     const th = thead.append("th")
//       // .attr("class", `sticky-header--${i}`)
//       .style("cursor", "pointer")
//       .on("click", () => sortTableByColumn(header));

//     gwHeaderMap.set(header, th);
//   });



//   // Table body
//   const tbody = table.append("tbody");



//   function updateTableBody(teamData) {
//     tbody.selectAll("tr").remove();


//     // Table Rows 
//     teams.forEach((team, index) => {
//       // Group fixtures by GW
//       team.fixtures_by_gw = d3.group(team.fixtures, d => d.gwId); // Map<gw, [fixtures]>

//       // Add new row
//       const row = tbody.append("tr").attr("class", "fixture-xg-table__row");
      
//       // Rank
//       row.append("td").attr("class", "fixture-xg-table__cell fixture-xg-table__cell--rank fixture-xg-table__cell--sticky fixture-xg-table_rank-col--sticky").text(`${index + 1}.`);
      
//       // Team Info Column
//       const team_name = teamMap.get(team.team_code).team_short;
//       const team_off = ratingMap.get(team.team_code).off_rating;
//       const team_def = ratingMap.get(team.team_code).def_rating;
//       const team_logo = getTeamLogoURL(team.team_code);
      
//       const teamCell = row.append("td").attr("class", "fixture-xg-table__cell fixture-xg-table__cell--team fixture-xg-table__cell--sticky fixture-xg-table_team-col--sticky");
//       // Row with [logo] Team Name
//       const nameRow = teamCell.append("div")
//         .attr("class", "fixture-xg-table__col--team");

//       nameRow.append("img")
//         .attr("src", team_logo)
//         .attr("alt", team_name)
//         .attr("class", "fixture-xg-table__team-logo");

//       nameRow.append("span")
//         .attr("class", "fixture-xg-table__team-name")
//         .text(team_name);

//       // Ratings below
//       teamCell.append("div")
//         .attr("class", "fixture-xg-table__team-meta")
//         .text(`OFF: ${team_off.toFixed(2)} | DEF: ${team_def.toFixed(2)}`);

//       // teamCell.append("div")
//       //   .attr("class", "fixture-xg-table__team-meta")
//       //   .text(`DEF | ${team_def.toFixed(2)}`);

//       // xG Circle
//       row.append("td")
//         .attr("class", "fixture-xg-table__col--metric fixture-xg-table__cell fixture-xg-table__cell--sticky fixture-xg-table_metric-col--sticky")
//         .append("div")
//         .attr("class", "fixture-xg-table__circle circle circle--xg")
//         // .style("background-color", xgColorScale(team.total_xg))
//         // .style("color", getTextColor(xgColorScale(team.total_xg)))
//         .style("font-weight", "bold")
//         .text(team.total_metric.toFixed(1));

//       GAMEWEEKS_TO_SHOW.forEach(gw => {
//         const fixturesThisGW = team.fixtures_by_gw.get(gw) || [];

//         const cell = row.append("td")
//           .attr("class", "fixture-xg-table__cell fixture-xg-table__cell--fixture")
//           .style("padding", "4px");

//         if (fixturesThisGW.length === 0) {
//           cell.text("-").style("text-align", "center");
//         } else {
//           fixturesThisGW.forEach((fixture, i) => {
//             cell.append("div")
//               .attr("class", "fixture-xg-table__fixture-box")
//               .style("background-color", colorScale(fixture.xg_for))
//               .style("color", getTextColor(colorScale(fixture.xg_for)))
//               .style("font-weight", "bold")
//               .style("font-size", "0.85em")
//               .style("text-align", "center")
//               .style("padding", `${2 / fixturesThisGW.length}px 0`)
//               .style("width", "100%")
//               .style("line-height", `${40 / fixturesThisGW.length}px`)
//               .style("box-sizing", "border-box")
//               .style("display", "block")
//               .style("border", `0.5px solid black`)
//               .style("margin-bottom", i < fixturesThisGW.length - .1 ? "1px" : "0") // space between boxes
//               .text(
//                 METRIC_TYPE === "attack" 
//                   ? fixture.xg_for.toFixed(2) 
//                   : fixture.cs_prob.toFixed(2)
//               )
//               .style("background-color", 
//                 METRIC_TYPE === "attack"
//                   ? colorScale(fixture.xg_for)
//                   : colorScale(fixture.cs_prob)
//               )
//               .style("color", 
//                 METRIC_TYPE === "attack"
//                   ? getTextColor(colorScale(fixture.xg_for))
//                   : getTextColor(colorScale(fixture.cs_prob))
//               );

//           });
//         }
//       });



    
//     // END of table loop
//     });
//   };
  
//   // Sort Functions
//   function sortTableByColumn(headerLabel) {
//     const isGW = headerLabel.startsWith("GW");
//     const key = headerLabel;

//     const ascending = currentSort.column === key ? !currentSort.ascending : false;
//     currentSort = { column: key, ascending };

//     // Sorting logic
//     const sorted = teams.sort((a, b) => {
//       let aVal, bVal;

//       if (isGW) {
//         const gwNum = +key.replace("GW", "");
//         aVal = d3.sum(a.fixtures_by_gw.get(gwNum) || [], d => 
//           METRIC_TYPE === "attack" ? d.xg_for : d.cs_prob
//         );
//         bVal = d3.sum(b.fixtures_by_gw.get(gwNum) || [], d => 
//           METRIC_TYPE === "attack" ? d.xg_for : d.cs_prob
//         );
//       } else {
//         switch (key) {
//           case "#":
//             aVal = a.rank;
//             bVal = b.rank;
//             break;
//           case "Team":
//             aVal = teamMap.get(a.team_code)?.team_short;
//             bVal = teamMap.get(b.team_code)?.team_short;
//             break;
//           case "xG":
//           case "xCS": // Optional alias if you use that label
//             aVal = a.total_metric;
//             bVal = b.total_metric;
//             break;
//           default:
//             aVal = 0;
//             bVal = 0;
//         }
//       }

//       return ascending ? d3.ascending(aVal, bVal) : d3.descending(aVal, bVal);
//     });

//     // Update header arrows
//     staticHeaderMap.forEach((th, label) => {
//       const arrow = label === key ? (ascending ? " ↑" : " ↓") : "";
//       th.text(label.toUpperCase() + arrow);
//     });

//     gwHeaderMap.forEach((th, label) => {
//       const arrow = label === key ? (ascending ? " ↑" : " ↓") : "";
//       th.text(label.toUpperCase() + arrow);
//     });

//     // Rerender table body
//     updateTableBody(sorted);
//   }


//   function updateHeaderLabels() {
//     staticHeaderMap.forEach((th, label) => {
//       const arrow = currentSort.column === label
//         ? (currentSort.ascending ? " ↑" : " ↓")
//         : "";
//       th.text(label.toUpperCase() + arrow);
//     });

//     gwHeaderMap.forEach((th, label) => {
//       const arrow = currentSort.column === label
//         ? (currentSort.ascending ? " ↑" : " ↓")
//         : "";
//       th.text(label.toUpperCase() + arrow);
//     });
//   }


//   updateTableBody(teams)
//   updateHeaderLabels()

  
// });





















  // // 2. Convert to array and calculate total xG for sorting
  // const teams = Array.from(teamMap.values()).map(team => {
  //   team.total_xg = team.fixtures.reduce((sum, f) => sum + f.xg, 0);
  //   return team;
  // });

  // // 3. Sort teams by total_xg (descending)
  // teams.sort((a, b) => b.total_xg - a.total_xg);

  // // 4. Render table with D3
  // const container = d3.select(".fixture-xg-table-container");
  // const table = container.append("table").attr("class", "fixture-xg-table");

  // // Table header
  // const thead = table.append("thead").append("tr");
  // ["#", "Team", "xG", "xCS", "xG vs xGA"].forEach(header =>
  //   thead.append("th").text(header)
  // );

  // // Table body
  // const tbody = table.append("tbody");

  // teams.forEach((team, index) => {
  //   const row = tbody.append("tr").attr("class", "fixture-xg-table__row");
    
  //   // Rank
  //   row.append("td").attr("class", "fixture-xg-table__cell fixture-xg-table__cell--rank").text(index + 1);


  //   const teamCell = row.append("td").attr("class", "fixture-xg-table__cell fixture-xg-table__cell--team");
  //   teamCell.append("div").attr("class", "fixture-xg-table__team-name").text(team.team_name.slice(0, 7));
  //   teamCell.append("div")
  //     .attr("class", "fixture-xg-table__team-meta")
  //     .text(`OFF: ${team.off_rating}`);
  //   teamCell.append("div")
  //     .attr("class", "fixture-xg-table__team-meta")
  //     .text(`DEF: ${team.def_rating}`);

  //   // xG Circle
  //   row.append("td")
  //     .attr("class", "fixture-xg-table__cell")
  //     .append("div")
  //     .attr("class", "fixture-xg-table__circle circle circle--xg")
  //     .style("background-color", d3.interpolateBlues(team.total_xg / 10))
  //     .text(20);


  //   // CS Circle
  //   row.append("td")
  //     .attr("class", "fixture-xg-table__cell")
  //     .append("div")
  //     .attr("class", "fixture-xg-table__circle circle circle--cs")
  //     .style("background-color", d3.interpolateGreens(team.total_cs / team.fixtures.length))
  //     .text(2);

  //   // Mini bar chart
  //   const fixturesToShow = team.fixtures.slice(0, 9);
  //   const chartWidth = fixturesToShow.length;
  //   // const yScaleMax = 2;
  //   const barWidth = 4;
  //   const barGap = 2;
  //   const chartHeight = 30;
  //   const baseline = chartHeight / 2;
  //   // const scaleY = d3.scaleLinear()
  //   //   .domain([0, yScaleMax])
  //   //   .range([0, baseline]); // Scale from 0 to half height


  //   const chartWrapper = row.append("td")
  //     .attr("class", "fixture-xg-table__cell fixture-xg-table__cell--trend");

  //   const chartSvg = chartWrapper.append("svg")
  //     .attr("class", "fixture-xg-table__chart")
  //     .attr("height", chartHeight)
  //     .attr("viewBox", `0 0 ${chartWidth * (barWidth + barGap)} ${chartHeight}`)
  //     .attr("preserveAspectRatio", "none");

  //   // Add <g> for gridlines first (back layer)
  //   const gridGroup = chartSvg.append("g").attr("class", "fixture-xg-table__grid");
  //   // Then a group for bars (middle layer)
  //   const barsGroup = chartSvg.append("g").attr("class", "fixture-xg-table__bars");
  //   // Optional: overlay for baseline or labels (top layer)
  //   const overlayGroup = chartSvg.append("g").attr("class", "fixture-xg-table__overlay");

  //   for (let i = 0; i <= team.fixtures.length; i++) {
  //     const x = i * (barWidth + barGap);
  //     gridGroup.append("line")
  //       .attr("x1", x)
  //       .attr("x2", x)
  //       .attr("y1", 0)
  //       .attr("y2", chartHeight)
  //       .attr("stroke", "#ddd")
  //       .attr("stroke-width", 0.25);
  //   };

  //   fixturesToShow.forEach((f, i) => {
  //     const x = i * (barWidth + barGap);
  //     const xCenter = x + barWidth / 2;
  //     const maxXG = d3.max(fixturesToShow, f => f.xg_for || 0);
  //     const maxXGA = d3.max(fixturesToShow, f => f.xg_against || 0);
  //     const yScaleMax = Math.ceil(Math.max(maxXG, maxXGA)) * 1.25; // e.g. round up to nearest whole number
  //     const scaleY = d3.scaleLinear()
  //       .domain([0, yScaleMax])
  //       .range([0, baseline]); // Convert data value to bar height
  //     const xgForHeight = scaleY(f.xg_for);
  //     const xgAgainstHeight = scaleY(f.xg_against);

  //     // Grid lines
  //     const yTicks = d3.range(0, yScaleMax + 0.1, yScaleMax / 4);
  //     yTicks.forEach(tick => {
  //     const offset = scaleY(tick);
  //     gridGroup.append("line")
  //       .attr("x1", 0)
  //       .attr("x2", chartWidth * (barWidth + barGap))
  //       .attr("y1", baseline - offset)
  //       .attr("y2", baseline - offset)
  //       .attr("stroke", "#ddd")
  //       .attr("stroke-width", 0.25);

  //     gridGroup.append("line")
  //       .attr("x1", 0)
  //       .attr("x2", chartWidth * (barWidth + barGap))
  //       .attr("y1", baseline + offset)
  //       .attr("y2", baseline + offset)
  //       .attr("stroke", "#ddd")
  //       .attr("stroke-width", 0.25);
  //     });

  //     // xG (for) – upward from baseline
  //     barsGroup.append("rect")
  //       .attr("x", x)
  //       // .attr("y", baseline - scaleY(f.xg_for))
  //       .attr("y", baseline - xgForHeight)
  //       .attr("width", barWidth)
  //       // .attr("height", scaleY(f.xg_for))
  //       .attr("height", xgForHeight)
  //       // .attr("fill", "#1f77b4");
  //       .attr("stroke", "black")
  //       .attr("stroke-width", ".035rem")
  //       .attr("fill", "black");

  //     // Labels – xG (above bar)
  //     overlayGroup.append("text")
  //       .attr("x", xCenter)
  //       .attr("y", baseline - xgForHeight - 1)
  //       .attr("text-anchor", "middle")
  //       .attr("font-size", ".15rem")
  //       .attr("font-weight", "bold")
  //       .attr("fill", "black")
  //       .attr("stroke", "white")
  //       .attr("stroke-width", "0.005rem")
  //       .text(f.xg_for.toFixed(1));

  //     // xG (against) – downward from baseline
  //     barsGroup.append("rect")
  //       .attr("x", x)
  //       .attr("y", baseline)
  //       // .attr("height", scaleY(f.xg_against))
  //       .attr("height", xgAgainstHeight)
  //       .attr("width", barWidth)
  //       // .attr("fill", "#d62728");
  //       .attr("stroke", "black")
  //       .attr("stroke-width", ".035rem")
  //       .attr("fill", "white");

  //     // // Labels – xGA (below bar)
  //     overlayGroup.append("text")
  //       .attr("x", xCenter)
  //       .attr("y", baseline + xgAgainstHeight + 3)
  //       .attr("text-anchor", "middle")
  //       .attr("font-size", ".15rem")
  //       .attr("font-weight", "bold")
  //       .attr("fill", "black")
  //       .attr("stroke", "white")
  //       .attr("stroke-width", "0.005rem")
  //       .text(f.xg_against.toFixed(1));
  //   });

  //   overlayGroup.append("line")
  //     .attr("x1", 0)
  //     .attr("x2", chartWidth * (barWidth + barGap))
  //     .attr("y1", baseline)
  //     .attr("y2", baseline)
  //     .attr("stroke", "black")
  //     .attr("stroke-width", .5);





  // // Table Body End
  // });
