// TODO: row highlighting`

Promise.all([
  d3.json("data/teams.json"),
  d3.json("data/gameweeks.json"),
  d3.json("data/fixtures.json"),
  d3.json("data/config.json")
]).then(([teamsData, gameweeks, fixturesData, config]) => {
  // Set gameweek configs
  // const activeGW = 29   // config.active_gw; // e.g., "GW3"
  const maxGwNum = 38;
  const numGwsToShow = 5;
  // elo calculations 
  const time_decay_lambda = 0.3;        // Time decay constant
  const homeAdvantageAdjustment = 0;    // reduce opponent Elo by 15 if home
  const awayAdvantageAdjustment = 0;    // no change if away

  // Prepare a lookup for team info
  const teamMap = new Map(
    teamsData.map(team => [
      team.team_code,
      {
        team_code: team.team_code,
        team_name: team.team,
        team_name_short: team.team_short,
        team_logo_path: team.team_logo_path,
        elo: team.elo_opta,  
      }
    ])
  );

  // Compute median, min max Elo
  const medianElo = 90;
  const maxElo = 100;
  const minElo = 80;

  // Create a diverging scale with median in the middle
  const colorScale = d3.scaleDiverging()
    .domain([minElo, medianElo, maxElo])
    .interpolator(customDivergingInterpolatorGreenPurple)  // green to grey to purple

  
  // Group fixtures by team
  const fixturesByTeam = d3.group(fixturesData, d => d.team_code);

  // Helper to get average opponent Elo per GW, counting blanks as maxElo
  function getOpponentElo(teamFixtures, gwNum) {
    const gwKey = `gw${gwNum}`;
    const matches = teamFixtures?.fixtures?.[gwKey] || [];
    if (matches.length === 0) return maxElo * 1.06;

    const adjustedElos = matches.map(match => {
      const opp = teamMap.get(match.opponent);
      if (!opp) return maxElo;
      
      let elo = opp.elo;

      // Adjust Elo based on home/away
      if (match.home_label.toLowerCase() === "h") {
        elo += homeAdvantageAdjustment;  // reduce opponent Elo when home
      } else if (match.home_label.toLowerCase() === "a") {
        elo += awayAdvantageAdjustment;  // adjust if away
      }

      // Ensure Elo doesn’t go below a minimum threshold (optional)
      return Math.max(elo, 70);  // avoid negative or unrealistically low Elo
    });

    return d3.mean(adjustedElos);
  };

  // Compute mean Elo of all opponents for this team across selected GWs
  function getMeanElo(teamFixtures, gwList) {
    return d3.mean(gwList.map(gw => getOpponentElo(teamFixtures, gw.gwNum)));
  };

  // Compute median Elo of all opponents for this team across selected GWs
  function getMedianOpponentElo(teamFixtures, gwList) {
    return d3.median(gwList.map(gw => getOpponentElo(teamFixtures, gw.gwNum)));
  };

  // Compute time-weighted mean Elo of all opponents for this team across selected GWs
  function getWeightedMeanElo(teamFixtures, gwList) {
      let weightedSum = 0;
      let weightTotal = 0;

      gwList.forEach((gw, i) => {
        const weight = Math.exp(-time_decay_lambda * i);
        const elo = getOpponentElo(teamFixtures, gw.gwNum);
        weightedSum += elo * weight;
        weightTotal += weight;
      });

      return weightedSum / weightTotal;
  };


  function renderTickerChart() {
    // === Clear table ===
    d3.select("#fixture-ticker-table").selectAll("*").remove();

    // === Get user inputs ===
    const activeGWInput = document.getElementById("active-gw");
    const activeGW = activeGWInput ? parseInt(activeGWInput.value, 10) : config.active_gw;
    console.log(activeGW)
    const numGwsToShow = parseInt(document.getElementById("num-gws").value);
    const useDecay = document.getElementById("use-decay").checked;
    const isCompact = document.getElementById("compact-toggle").checked;
    const compactClass = isCompact ? "compact" : "";

    // Show next N gameweeks based on active gw
    const gameweeksToShow = d3.range(activeGW, Math.min(activeGW + numGwsToShow, maxGwNum + 1))
      .map(gwNum => ({ gwNum }));


    // select weighted or unweighted elo
    const getMetric = useDecay ? getWeightedMeanElo : getMeanElo;

     // Sort teams by mean opponent Elo ascending (weakest opponents first)
    const sortedTeams = Array.from(teamMap.values())
      .sort((a, b) => {
        const teamFixturesA = fixturesByTeam.get(a.team_code)?.[0];
        const teamFixturesB = fixturesByTeam.get(b.team_code)?.[0];
        return getMetric(teamFixturesA, gameweeksToShow) - getMetric(teamFixturesB, gameweeksToShow);
    });

    // Sort teams alphabetically by display name
    // const sortedTeams = Array.from(teamMap.values())
    //   .sort((a, b) => d3.ascending(a.team_name, b.team_name));


    // 
    // VIZ - FIXTURE TICKER //
    // Chart: Table
    // One row per team, showing upcoming opponents, coloured by ELO
    //


    // Create Fixture Ticker (table)
    const table = d3.select("#fixture-ticker-table");
    const thead = table.append("thead").append("tr");
    const tbody = table.append("tbody");

    // styling / spacing based on gameweeksToShow 
    const gap = gameweeksToShow.length <= 5 ? 4 : 2;

    // === Build Table Headers ===
    // # | TEAM | GW20 | GW21 | ...
    thead.append("th").text("#").attr("class", "ticker-header-rank sticky-col-rank"); 
    thead.append("th").text("TEAM").attr("class", `ticker-header-team sticky-col-team ${compactClass}`);
    // Add gameweek header for each GW in selection
    gameweeksToShow.forEach(gw => {
      thead.append("th").text(`GW${gw.gwNum}`).attr("class", "ticker-header-gw-id");
    });

    // === Build Main Rows
    // === Team Rows with Fixture Data ===
    sortedTeams.forEach(team => {
      const row = tbody.append("tr");

      // Add rank number
      row.append("td").text(`${sortedTeams.indexOf(team) + 1}.`).attr("class", "ticker-cell-rank");

      // Add team logo and name in the next cell/column
      const teamLogoURL = getTeamLogoURL(team.team_code);
      const cell = row.append("td").attr("class", "ticker-cell-team");
      // cell.html(`
      //   <div class="ticker-team-cols">
      //     <img class="ticker-team-logo" src="${teamLogoURL}" alt="${team.team_name_short}"/>
      //     <span class="ticker-team-name">${team.team_name_short}</span>
      //   </div>
      // `);
      cell.html(`
        <div class="ticker-team-container ${compactClass}">
          <div class="ticker-team-cols">
            <img class="ticker-team-logo" src="${teamLogoURL}" alt="${team.team_name_short}"/>
            <span class="ticker-team-name">${team.team_name_short}</span>
          </div>
          <div class="ticker-team-meta">
            POS: 4TH | ELO: ${team.elo.toFixed(1)}
          </div>
        </div>
      `);


      // Fixture columns: Fill cell values with fixtures
      // Loop through each gameweek
      gameweeksToShow.forEach(gw => {
        // gw.gwNum assumed to be a number like 1, 2, 3
        const gwKey = `gw${gw.gwNum}`; // e.g., 1 → "gw1"

        // Get the fixture(s) for current team in this gw
        // fixturesByTeam is a Map keyed by team_code, with an array of fixtures
        const teamFixtures = fixturesByTeam.get(team.team_code)?.[0];
        const matches = teamFixtures?.fixtures?.[gwKey] || [];
        // fill cell values
        const cell = row.append("td");

        // check how man matches in gw for this team
        if (matches.length === 0) {
          // blank gw - no fixtures found in this gw for this team
          cell.attr("class", "ticker-gw-cell ticker-blank-gw").html('<span class="ticker-blank-gw-span">-</span>');

        } else if (matches.length === 1) {
          // normal gw - with 1 match
          // TODO: home/away/blank adjustment
           const opponents = matches.map(match => {
            const opp = teamMap.get(match.opponent);
            const color = colorScale(opp.elo);
            const textColor = getTextColor(color);
            // cell.style("border", "1px solid red");
            
            cell.html(`
              <div class="ticker-gw-cell ticker-single-gw ${compactClass}" 
                style="background-color: ${color}; color: ${textColor};"
                data-elo="${opp.elo.toFixed(1)}"
              >
                <span class="ticker-single-gw-opp-label">${opp.team_name_short}</span>
                <span class="ticker-single-gw-home-label">(${match.home_label.toUpperCase()})</span>
              </div>
            `);
          });

        } else if (matches.length === 2) {
          // double gw
           const opponents = matches.map((match, index) => {
            const opp = teamMap.get(match.opponent);
            const color = colorScale(opp.elo);
            // const color = "#FF5A5F";
            const textColor = getTextColor(color);
            return `<span class="ticker-double-gw-span-${index}" 
                    style="background-color: ${color}; color: ${textColor};"
                    data-elo="${opp.elo.toFixed(1)}"
                  >
                    <span class="ticker-double-gw-opp-label">${opp.team_name_short}</span>
                    <span class="ticker-double-gw-home-label">(${match.home_label.toUpperCase()})</span>
                  </span>`;
          });
          // cell.html(opponents.join(""));
          // cell.style("border", "2px dotted #087E8B");

          // add the double gw spans
          cell.html(`
            <div class="ticker-gw-cell ticker-double-gw ${compactClass}">
              ${opponents.join("")}
            </div>
          `);
        
        } else {
          // triple GW or more
          // TODO
          cell.attr("class", "ticker-gw-cell ticker-triple-gw").html(`
            <div class="ticker-gw-cell ticker-triple-gw ${compactClass}"
            style="background-color: #FF5A5F; color: white;">
            '<span class="ticker-triple-gw-span">TGW</span>'
          `
            
          );
        };
      });
    });

    // === Tooltip binding ===
    d3.selectAll(".ticker-single-gw, .ticker-double-gw, .ticker-triple-gw")
      .on("mouseover", function (event) {
        if (isTouchDevice) return; // skip hover behavior on touch devices

        showTooltip.call(this, event);
      })
      .on("mousemove", function (event) {
        if (isTouchDevice) return;
        moveTooltip(event);
      })
      .on("mouseout", function () {
        if (isTouchDevice) return;
        hideTooltip();
      })
      .on("click", function (event) {
        if (!isTouchDevice) return;

        // If tooltip is already visible and this is the same element, hide it
        if (tooltipVisible && activeTooltipElement === this) {
          hideTooltip();
          return;
        }

        suppressHide = true;
        activeTooltipElement = this;
        showTooltip.call(this, event);
        moveTooltip(event);
        setTimeout(() => suppressHide = false, 0); // Let event propagation finish
      });


    // === Tooltip helpers ===
    function showTooltip(event) {
      const cell = d3.select(this);
      const td = cell.node().closest("td");
      const tr = td.closest("tr");
      const table = td.closest("table");

      const cellIndex = td.cellIndex;
      const ths = table.querySelectorAll("thead th");
      const gwText = ths[cellIndex]?.textContent || "";

      const teamName = tr.querySelector(".ticker-team-name").textContent;
      const teamLogoURLtooltip = tr.querySelector(".ticker-team-logo").getAttribute("src");

      const formatHomeAway = (code) => {
        if (!code) return "";
        const lower = code.toLowerCase();
        return lower === "h" ? "at home" : lower === "a" ? "away" : "";
      };

      let opponentText = "";

      if (cell.classed("ticker-single-gw")) {
        // SINGLE GW
        const oppName = cell.select(".ticker-single-gw-opp-label")?.text() || "N/A";
        const homeCode = cell.select(".ticker-single-gw-home-label")?.text()?.replace(/[()]/g, '') || "";
        const elo = cell.attr("data-elo") || "???";
        opponentText = `Playing against <strong>${oppName} (${parseFloat(elo).toFixed(1)})</strong> ${formatHomeAway(homeCode)}`;
      } else {
        // MULTI GW
        const spans = cell.selectAll("span").nodes().filter(span =>
          span.classList.contains("ticker-double-gw-span-0") ||
          span.classList.contains("ticker-double-gw-span-1") ||
          span.classList.contains("ticker-triple-gw-span")
        );

        const matchSummaries = spans.map(span => {
          const spanSel = d3.select(span);
          const oppName = spanSel.select(".ticker-double-gw-opp-label, .ticker-triple-gw-opp-label").text() || "N/A";
          const homeCode = spanSel.select(".ticker-double-gw-home-label, .ticker-triple-gw-home-label").text()?.replace(/[()]/g, '') || "";
          const elo = spanSel.attr("data-elo") || "???";
          return `<strong>${oppName} (${parseFloat(elo).toFixed(1)})</strong> ${formatHomeAway(homeCode)}`;
        });

        // CREATE TOOLTIP TEXT
        opponentText = `Playing against ${matchSummaries.map((txt, i, arr) => {
          if (i === arr.length - 1 && arr.length > 1) return "and " + txt;
          return txt;
        }).join(", ")}`;
      };

      // ADD TOOLTIP
      tooltip
        .style("display", "block")
        .html(`
          <div class="ticker-tooltip-header">
            <img src="${teamLogoURLtooltip}" alt="${teamName} logo">
            <strong>${teamName}</strong> | <span>${gwText}</span>
          </div>
          <hr>
          <div>${opponentText}</div>
        `);

      tooltipVisible = true;
    }

    function moveTooltip(event) {
      const tooltipNode = tooltip.node();
      const tooltipWidth = tooltipNode.offsetWidth;
      const tooltipHeight = tooltipNode.offsetHeight;

      const pageX = event.pageX;
      const pageY = event.pageY;
      const viewportWidth = window.innerWidth;

      let left = pageX + 10;
      let top = pageY - 40;

      if (pageX + tooltipWidth + 20 > viewportWidth) {
        left = pageX - tooltipWidth - 10;
      }

      if (top < 0) {
        top = pageY + 10;
      }

      tooltip
        .style("left", `${left}px`)
        .style("top", `${top}px`);
    };

  };

  // === TOOLTIP SETUP ===
  const tooltip = d3.select("#tooltip");
  let tooltipVisible = false;
  let suppressHide = false;
  let activeTooltipElement = null;
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  function hideTooltip() {
    tooltip.style("display", "none");
    tooltipVisible = false;
    activeTooltipElement = null;
  }

  document.addEventListener("touchstart", (e) => {
    if (suppressHide) return;
    if (tooltipVisible && !tooltip.node().contains(e.target)) {
      hideTooltip();
    }
  });

  document.addEventListener("click", (e) => {
    if (suppressHide) return;
    if (tooltipVisible && !tooltip.node().contains(e.target)) {
      hideTooltip();
    }
  });

  window.addEventListener("scroll", () => {
    if (tooltipVisible) hideTooltip();
  }, { passive: true });

  window.addEventListener("resize", () => {
    if (tooltipVisible) hideTooltip();
  });

  // Set active GW input from config loaded via Promise.all, then render chart
  const activeGwInput = document.getElementById("active-gw");
  if (activeGwInput && config.active_gw) {
    activeGwInput.value = config.active_gw;
  }

  // Initial load -- after set active GW
  renderTickerChart();


  // Automatically update chart when any input changes
  document.getElementById("active-gw").addEventListener("input", renderTickerChart);
  document.getElementById("num-gws").addEventListener("input", renderTickerChart);
  document.getElementById("use-decay").addEventListener("change", renderTickerChart);
  document.getElementById("compact-toggle").addEventListener("change", renderTickerChart);

});