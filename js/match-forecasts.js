// make GW and match date dynamic

Promise.all([
  d3.json("data/d3_teams.json"),
  d3.json("data/d3_match_forecasts.json"),
  d3.json("data/d3_score_matrix.json"),
  d3.json("data/d3_config.json")
]).then(([teamInfo, fixtures, scoreMatrix, config]) => {

  // Load the data
  const fixture = scoreMatrix[0];
  const fixtureId = fixture.fixture_id;
  const matrix = fixture.score_matrix;

  const selector = d3.select("#match-selector");
  const filteredFixtures = fixtures.filter(d => d.gw === config.active_gw + 1);

  selector.selectAll("option")
    .data(filteredFixtures)
    .enter()
    .append("option")
    .attr("value", d => d.fixture_id)
    .text(d => `${d.home_team} vs. ${d.away_team} (GW${d.gw})`);

  // Get relevant fixture information
  // const matchedFixture = fixtures.find(f => f.fixture_id === fixtureId);
  // const homeTeamName = matchedFixture.home_team;
  // const awayTeamName = matchedFixture.away_team;


  // Set the maximum number of goals (including 0) to display
  const maxGoalsInMatrix = matrix[0].length;
  const maxGoalDisplay = 5;
  const groupGoal = g => Math.min(g, 4);

  // Fill grouped matrix by summing over matching cells
  function groupMatrix(matrix) {
    const grouped = Array.from({ length: maxGoalDisplay }, () => Array(maxGoalDisplay).fill(0));
    for (let i = 0; i < maxGoalsInMatrix; i++) {
      for (let j = 0; j < maxGoalsInMatrix; j++) {
        grouped[groupGoal(j)][groupGoal(i)] += matrix[i][j];
      }
    }
    return grouped;
  }

  // Function to combine the "overspill" goals beyond maxGoalDisplay
  function groupMarginals(probArray) {
    const grouped = Array(maxGoalDisplay).fill(0);
    for (let i = 0; i < probArray.length; i++) {
      grouped[groupGoal(i)] += probArray[i];
    }
    return grouped;
  }


  function drawMatchForecast(fixtureId) {
    // Clear previous SVG
    // d3.select(".match-forecasts-container").select("svg").remove();
    d3.select("#match-forecasts-matrix").selectAll("*").remove();

    // Get relevant data
    // const fixture = scoreMatrix[0];
    // const fixtureId = fixture.fixture_id;
    // const matrix = fixture.score_matrix;

    const fixture = scoreMatrix.find(f => f.fixture_id == fixtureId);
    if (!fixture) return;

    const matchedFixture = fixtures.find(f => f.fixture_id == fixtureId);
    if (!matchedFixture) return;
    const formatDate = d3.timeFormat("%d %B %Y");
    const homeTeamName = matchedFixture.home_team;
    const awayTeamName = matchedFixture.away_team;
    const homeTeamCode = matchedFixture.home_team_code;
    const awayTeamCode = matchedFixture.away_team_code;
    const homeTeamShort = teamInfo.find(f => f.team_code == homeTeamCode).team_short;
    const awayTeamShort = teamInfo.find(f => f.team_code == awayTeamCode).team_short;
    const fixtureGW = matchedFixture.gw;
    const fixtureMatchDate = formatDate(matchedFixture.match_date);
    const matrix = fixture.score_matrix;

    // Group the Score Matrix
    const groupedMatrix = groupMatrix(matrix);
    const homeProb = d3.range(maxGoalsInMatrix).map(col => d3.sum(matrix.map(row => row[col])));
    const awayProb = matrix.map(row => d3.sum(row));
    const groupedHomeProb = groupMarginals(homeProb);
    const groupedAwayProb = groupMarginals(awayProb);

    // Get the Match Outcome Probabilities
    const homeWinProb = d3.sum(matrix.map((row, i) => d3.sum(row.slice(0, i))));
    const awayWinProb = d3.sum(matrix.map((row, i) => d3.sum(row.slice(i + 1))));
    const drawProb = d3.sum(matrix.map((row, i) => row[i]));

    // ------------------------ //
    // --- Viz Layout Setup --- //
    // ------------------------ //
    const matrixContainer = d3.select(".match-forecasts-container").node();
    const containerWidth = matrixContainer.getBoundingClientRect().width;
    const cellSize = containerWidth / (maxGoalDisplay + 4);

    // Padding arodun viz area
    // const padding = cellSize * 1.5;
    const paddingTop = cellSize * 0.75;
    const paddingBottom = cellSize * 0.6;
    const paddingLeft = cellSize * 1.25;
    const paddingRight = cellSize * 0.5; 

    const barChartSize = cellSize * 2;
    const gap = cellSize * 0.95;
    const barThickness = cellSize * 0.4;
    const barOffset = (cellSize - barThickness) / 2;
    
    // SVG final size
    // const svgSize = maxGoalDisplay * cellSize + padding * 2 + barChartSize + gap;
    const svgWidth = maxGoalDisplay * cellSize + paddingLeft + paddingRight + barChartSize + gap;
    const svgHeight = maxGoalDisplay * cellSize + paddingTop + paddingBottom + barChartSize + gap;
    
    // Colors
    const colorScale = d3.scaleLinear()
      .domain([0, d3.max(groupedMatrix.flat())])
      .range(["#fff", COLORS.purple]);

    // Bar Scale Config
    const barScale = d3.scaleLinear().domain([0, 1]).range([0, cellSize * 1.25]);
    const barChartScale = d3.scaleLinear().domain([0, 1]).range([barChartSize, 0]);
    const goalLabels = ["0 goals", "1", "2", "3", "4+"];
    const goalIndexScale = d3.scaleBand().domain(goalLabels).range([0, cellSize * maxGoalDisplay]);


    // Create SVG
    const svg = d3.select("#match-forecasts-matrix")
      // .attr("viewBox", `0 0 ${svgSize} ${svgSize}`)
      .attr("viewBox", `0 0 ${svgWidth} ${svgHeight}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    // Select the header div and set its HTML content
    d3.select(".match-forecasts-matrix-header").html(`
      <div class="match-forecasts__title">
        <img src="${getTeamLogoURL(homeTeamCode)}" alt="${homeTeamName} logo" class="match-forecasts__team-logo-title" />
        ${homeTeamName.toUpperCase()}
        <span class="match-forecasts__title">VS.</span>
        <img src="${getTeamLogoURL(awayTeamCode)}" alt="${awayTeamName} logo" class="match-forecasts__team-logo-title" />
        ${awayTeamName.toUpperCase()}
      </div>
      <div class="match-forecasts__sub-title">
        Pre-Match Forecast | Gameweek ${fixtureGW} | ${fixtureMatchDate}
      </div>
    `);

    // Draw the Score Matrix
    const matrixGroup = svg.append("g")
      .attr("transform", `translate(${paddingLeft + barChartSize + gap}, ${paddingLeft + barChartSize + gap})`);

    matrixGroup.selectAll("g")
      .data(groupedMatrix).enter().append("g")
      .attr("transform", (d, i) => `translate(0, ${i * cellSize})`)
      .selectAll("rect")
      .data(d => d).enter().append("rect")
      .attr("x", (d, i) => i * cellSize)
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("fill", d => colorScale(d));

    // Draw diagonal borders as separate rects
    matrixGroup.selectAll(".diagonal-border")
      .data(groupedMatrix.map((row, i) => ({ row: i, col: i })))
      .enter().append("rect")
      .attr("class", "diagonal-border")
      .attr("x", d => d.col * cellSize)
      .attr("y", d => d.row * cellSize)
      .attr("width", cellSize)
      .attr("height", cellSize)
      .attr("fill", "none")
      .attr("stroke", "#000")
      .attr("stroke-width", .75);


    // Draw Border Around Entire Matrix
    matrixGroup.append("rect")
      .attr("width", maxGoalDisplay * cellSize)
      .attr("height", maxGoalDisplay * cellSize)
      .attr("fill", "none")
      .attr("stroke", "black")
      .attr("stroke-width", 1.5);

    // Matrix Cell labels
    matrixGroup.selectAll(".matrix-text-row")
      .data(groupedMatrix).enter().append("g")
      .attr("transform", (d, i) => `translate(0, ${i * cellSize})`)
      .selectAll("text")
      .data(d => d).enter().append("text")
      .attr("x", (d, i) => i * cellSize + cellSize / 2)
      .attr("y", cellSize / 2)
      .attr("dy", ".35em")
      .attr("text-anchor", "middle")
      .attr("class", "match-forecasts__matrix-label")
      .style("fill", d => getTextColor(colorScale(d)))
      .text(d => d < 0.01 ? "<1%" : `${Math.round(d * 100)}%`);

    // Matrix labels with scorelines
    // matrixGroup.selectAll(".matrix-text-row")
    //   .data(groupedMatrix).enter().append("g")
    //   .attr("transform", (d, i) => `translate(0, ${i * cellSize})`)
    //   .selectAll("text")
    //   .data((row, rowIndex) => row.map((value, colIndex) => ({
    //     value,
    //     row: rowIndex,
    //     col: colIndex
    //   })))
    //   .enter().append("text")
    //   .attr("x", d => d.col * cellSize + cellSize / 2)
    //   .attr("y", cellSize / 2)
    //   .attr("text-anchor", "middle")
    //   .attr("class", "match-forecasts__matrix-label")
    //   .style("fill", d => getTextColor(colorScale(d.value)))
    //   .each(function(d) {
    //     const percent = d.value < 0.01 ? "<1%" : `${Math.round(d.value * 100)}%`;
    //     const formatGoal = g => g === 4 ? "4+" : g;
    //     const scoreline = `${formatGoal(d.row)}–${formatGoal(d.col)}`;


    //     d3.select(this)
    //       .append("tspan")
    //       .attr("x", d.col * cellSize + cellSize / 2)
    //       // .attr("dy", "-0.4em") // upward shift
    //       .text(percent);

    //     d3.select(this)
    //       .append("tspan")
    //       .attr("x", d.col * cellSize + cellSize / 2)
    //       .attr("dy", "2em") // downward shift for second line
    //       .attr("font-size", "0.5rem")
    //       .text(`(${scoreline})`);
    //   });

    function drawMatrixAxisLabels({ 
        svg, 
        data = ["0", 1, 2, 3, "4+"], 
        orientation = "x", 
        transform, 
        cellSize 
    }) {
      const labelGroup = svg.append("g")
        .attr("transform", transform)
        .selectAll("text")
        .data(data)
        .enter().append("text")
        .attr("class", "match-forecasts__tick-label")
        .attr(orientation === "x" ? "x" : "y", (d, i) => i * cellSize + cellSize / 2)
        .attr(orientation === "x" ? "y" : "x", -5)
        .attr("text-anchor", orientation === "x" ? "middle" : "end")
        .attr("alignment-baseline", "middle")
        .text(d => d);
    }

    // Column labels (x-axis)
    drawMatrixAxisLabels({
      svg,
      orientation: "x",
      transform: `translate(${paddingLeft + barChartSize + gap}, ${paddingLeft + barChartSize + gap - 5})`,
      cellSize
    });

    // Row labels (y-axis)
    drawMatrixAxisLabels({
      svg,
      orientation: "y",
      transform: `translate(${paddingLeft + barChartSize + gap - 5}, ${paddingLeft + barChartSize + gap})`,
      cellSize
    });


    // === Axis & Gridlines (draw first to be in background) ===
    function drawAxis({ scale, orientation, ticks, tickFormat, size, transform }) {
      let axis;
      
      if (orientation === "left") {
        axis = d3.axisLeft(scale);
      } else if (orientation === "bottom") {
        axis = d3.axisBottom(scale);
      } else if (orientation === "top") {
        axis = d3.axisTop(scale);
      }

      if (ticks !== undefined) axis.ticks(ticks);
      if (size !== undefined) axis.tickSize(size);
      if (tickFormat !== undefined) axis.tickFormat(tickFormat);

      svg.append("g")
        .attr("transform", transform)
        .call(axis)
        .call(g => g.selectAll(".tick line").attr("stroke", "#ccc"))
        .call(g => g.selectAll("path").remove())
        .call(g => g.selectAll("text").classed("match-forecasts__tick-label", true));
    }

    // Percent Axis -> Left Axis => Home Team Y-Axis
    drawAxis({
      scale: barChartScale,
      orientation: "left",
      ticks: 2,
      tickFormat: d3.format(".0%"),
      size: -maxGoalDisplay * cellSize,
      transform: `translate(${paddingLeft + barChartSize + gap - 4}, ${paddingLeft})`
    });

    // Percent Axis -> Bottom Axis => Away Team X-Axis
    drawAxis({
      scale: barChartScale,
      orientation: "top",
      ticks: 2,
      tickFormat: d3.format(".0%"),
      size: maxGoalDisplay * cellSize,
      transform: `translate(${paddingLeft}, ${paddingLeft + barChartSize + gap + maxGoalDisplay * cellSize + 4})`
    });

    // Goal Axis -> Top Axis => Home Team Top X-Axis
    drawAxis({
      scale: goalIndexScale,
      orientation: "top",
      tickFormat: d => d,
      size: -barChartSize * 1.1,
      transform: `translate(${paddingLeft + barChartSize + gap}, ${paddingLeft - 6})`
    });

    // Goal Axis -> Left Axis => Away Team Left Y-Axis
    drawAxis({
      scale: goalIndexScale,
      orientation: "left",
      tickFormat: d => d,
      size: -barChartSize * 1.1,
      transform: `translate(${paddingLeft - 6}, ${paddingLeft + barChartSize + gap})`
    });


    // === Bars ===
    function drawBars({ data, orientation, transform, scale, offset, thickness, color }) {
      const group = svg.append("g").attr("transform", transform);
      const selection = group.selectAll("rect").data(data).enter().append("rect");

      if (orientation === "vertical") {
        selection
          .attr("x", (d, i) => i * cellSize + offset)
          .attr("width", thickness)
          .attr("y", d => barChartScale(d))
          .attr("height", d => barChartSize - barChartScale(d));

        // Text Labels
        // Text label background (stroke)
        group.selectAll("text-stroke")
          .data(data).enter().append("text")
          .attr("x", (d, i) => i * cellSize + cellSize / 2)
          .attr("y", d => barChartScale(d) - 4)
          .attr("text-anchor", "middle")
          .attr("class", "match-forecasts__bar-label")
          .style("stroke", "white")
          .style("stroke-width", 3.5)
          .style("paint-order", "stroke")
          .style("fill", "none")
          .text(d => d < 0.01 ? "<1%" : `${Math.round(d * 100)}%`);

        // Text label fill
        group.selectAll("text-label")
          .data(data).enter().append("text")
          .attr("x", (d, i) => i * cellSize + cellSize / 2)
          .attr("y", d => barChartScale(d) - 4)
          .attr("text-anchor", "middle")
          .attr("class", "match-forecasts__bar-label")
          .style("fill", "black")
          .text(d => d < 0.01 ? "<1%" : `${Math.round(d * 100)}%`);

      } else {
        selection
          .attr("y", (d, i) => i * cellSize + offset)
          .attr("height", thickness)
          .attr("x", d => barChartScale(d))
          .attr("width", d => barChartSize - barChartScale(d));

        // Text Labels
        // Text label background (stroke)
        group.selectAll("text-stroke")
          .data(data).enter().append("text")
          .attr("y", (d, i) => i * cellSize + cellSize / 2 + 4)
          .attr("x", d => barChartScale(d) - 6)
          .attr("text-anchor", "end")
          .attr("class", "match-forecasts__bar-label")
          .style("stroke", "white")
          .style("stroke-width", 3.5)
          .style("paint-order", "stroke")
          .style("fill", "none")
          .text(d => d < 0.01 ? "<1%" : `${Math.round(d * 100)}%`);

        // Text label fill
        group.selectAll("text-label")
          .data(data).enter().append("text")
          .attr("y", (d, i) => i * cellSize + cellSize / 2 + 4)
          .attr("x", d => barChartScale(d) - 6)
          .attr("text-anchor", "end")
          .attr("class", "match-forecasts__bar-label")
          .style("fill", "black")
          .text(d => d < 0.01 ? "<1%" : `${Math.round(d * 100)}%`);
      
      }



      selection.attr("fill", color);
    }

    drawBars({
      data: groupedAwayProb,
      orientation: "vertical",
      transform: `translate(${paddingLeft + barChartSize + gap}, ${paddingLeft})`,
      scale: barChartScale,
      offset: barOffset,
      thickness: barThickness,
      color: COLORS.pink
    });

    drawBars({
      data: groupedHomeProb,
      orientation: "horizontal",
      transform: `translate(${paddingLeft}, ${paddingLeft + barChartSize + gap})`,
      scale: barChartScale,
      offset: barOffset,
      thickness: barThickness,
      color: COLORS.blue
    });


    // Summary Matrix
    const maxValue = Math.max(homeWinProb, awayWinProb, drawProb);
    const isHomeMax = homeWinProb === maxValue;
    const isAwayMax = awayWinProb === maxValue;
    const isDrawMax = drawProb === maxValue;
    const summaryWidth = barChartSize;
    

    const miniMatrixGroup = svg.append("g")
      .attr("transform", `translate(${paddingLeft}, ${paddingLeft})`);

    const miniCellSize = summaryWidth / maxGoalDisplay;
    const miniMatrixSize = miniCellSize * maxGoalDisplay;

    // === Draw all matrix cells ===
    for (let row = 0; row < maxGoalDisplay; row++) {
      for (let col = 0; col < maxGoalDisplay; col++) {
        miniMatrixGroup.append("rect")
          .attr("x", col * miniCellSize)
          .attr("y", row * miniCellSize)
          .attr("width", miniCellSize)
          .attr("height", miniCellSize)
          .attr("fill", "white")
          // .attr("stroke", "#ccc")
          .attr("stroke", "white")
          .attr("stroke-width", .5);
      }
    }

    // === Add borders around diagonal cells ===
    for (let i = 0; i < maxGoalDisplay; i++) {
      miniMatrixGroup.append("rect")
        .attr("x", i * miniCellSize)
        .attr("y", i * miniCellSize)
        .attr("width", miniCellSize)
        .attr("height", miniCellSize)
        // .attr("fill", isDrawMax ? COLORS.purple : "none")
        .attr("fill", "white")
        .attr("stroke", "black")
        .attr("stroke-width", .5);
    }

    // === Overlay background fill for most likely outcome ===
    const flatFill = COLORS.purple;
    const fillOpacity = 0.75;

    if (1===1) {
      for (let row = 0; row < maxGoalDisplay; row++) {
        for (let col = row + 1; col < maxGoalDisplay; col++) {
          miniMatrixGroup.append("rect")
            .attr("x", col * miniCellSize)
            .attr("y", row * miniCellSize)
            .attr("width", miniCellSize)
            .attr("height", miniCellSize)
            .attr("fill", COLORS.pink)
            .attr("fill-opacity", fillOpacity);
        }
      }
    }

    if (1===1) {
      for (let row = 1; row < maxGoalDisplay; row++) {
        for (let col = 0; col < row; col++) {
          miniMatrixGroup.append("rect")
            .attr("x", col * miniCellSize)
            .attr("y", row * miniCellSize)
            .attr("width", miniCellSize)
            .attr("height", miniCellSize)
            .attr("fill", COLORS.blue)
            .attr("fill-opacity", fillOpacity);
        }
      }
    }

    // === Determine center cells ===
    const centerDraw = Math.floor(maxGoalDisplay / 2);
    const centerHome = { x: Math.floor((maxGoalDisplay + 1) / 2), y: Math.floor((maxGoalDisplay - 2) / 2) };
    const centerAway = { x: Math.floor((maxGoalDisplay - 2) / 2), y: Math.floor((maxGoalDisplay + 1) / 2) };

    // === Add Labels ===
    function addLabel(x, y, text, bold, whiteText = false) {
      miniMatrixGroup.append("text")
        .attr("x", x * miniCellSize + miniCellSize / 2)
        .attr("y", y * miniCellSize + miniCellSize / 2)
        .attr("text-anchor", "middle")
        .attr("alignment-baseline", "middle")
        .attr("class", "match-forecasts__summary-label")
        .attr("fill", whiteText ? "white" : "black")
        // .attr("fill", "black")
        // .attr("font-weight", bold ? "bold" : "normal")
        .attr("font-weight", "bold")
        .text(text);
    }

    addLabel(centerHome.x, centerHome.y, `${Math.round(homeWinProb * 100)}%`, isHomeMax, true);
    addLabel(centerDraw, centerDraw, `${Math.round(drawProb * 100)}%`, isDrawMax);
    addLabel(centerAway.x, centerAway.y, `${Math.round(awayWinProb * 100)}%`, isAwayMax, true);

    // Add vertical axis title on bottom-left (for Away team prob)
    miniMatrixGroup.append("text")
      .attr("x", -2.5)
      .attr("y", miniCellSize * maxGoalDisplay)
      .attr("text-anchor", "start")
      .attr("class", "match-forecasts__summary-axis-title")
      .attr("fill", COLORS.blue)
      .attr("transform", `rotate(-90, ${-2.5}, ${miniCellSize * maxGoalDisplay})`) // rotate around the text position
      .text(`Away Win Probability `.toUpperCase());

    // Add horizontal axis title on top-right (for Home win prob)
    miniMatrixGroup.append("text")
      .attr("x", miniCellSize * maxGoalDisplay)
      .attr("y", -2.5)
      .attr("text-anchor", "end")
      .attr("class", "match-forecasts__summary-axis-title")
      .attr("fill", COLORS.pink)
      .text(`Home Win Probability `.toUpperCase());

    // Draw Border Around Entire Matrix
    miniMatrixGroup.append("rect")
      .attr("width", maxGoalDisplay * miniCellSize)
      .attr("height", maxGoalDisplay * miniCellSize)
      .attr("fill", "none")
      .attr("stroke", "black")
      .attr("stroke-width", .5);

    // Add horizontal axis title for Away Team
    const awayBarChartHeader = svg.append("text")
      .attr("x", paddingLeft * 0.5)
      .attr("y", (svgHeight - (maxGoalDisplay * cellSize)) * 0.85)
      .attr("class", "match-forecasts__bar-header");

    // First line: "Likelihood of "
    awayBarChartHeader.append("tspan")
      .attr("x", paddingLeft * 0.5)
      .attr("dy", 0)
      .text("Likelihood of ");

    // First line (continued): team name, styled
    awayBarChartHeader.append("tspan")
      .attr("fill", COLORS.blue)
      .attr("font-weight", "bold")
      .text(`${awayTeamShort}` + " ");

    // First line (continued): "scoring", unformatted
    awayBarChartHeader.append("tspan")
      .text("scoring");

    // Second line: rest of sentence
    awayBarChartHeader.append("tspan")
      .attr("x", paddingLeft * 0.5)
      .attr("dy", "1.2em")
      .text("a given number of goals");


    // Add horizontal axis title for Home Team
    // svg.append("text")
    //   .attr("class", "match-forecasts__bar-header")
    //   .attr("x", (paddingLeft + barChartSize + gap) * .88)
    //   .attr("y", svgHeight - barChartSize - gap - (maxGoalDisplay * cellSize) * 1.12)
    //   .text("Likelihood of BHA scoring a given number of goals");

    const homeBarChartHeader = svg.append("text")
      .attr("class", "match-forecasts__bar-header")
      .attr("x", (paddingLeft + barChartSize + gap) * 0.88)
      .attr("y", svgHeight - barChartSize - gap - (maxGoalDisplay * cellSize) * 1.12);

    // Start of sentence
    homeBarChartHeader.append("tspan")
      .text("Likelihood of ");

    // Team name styled
    homeBarChartHeader.append("tspan")
      .attr("fill", COLORS.pink)
      .attr("font-weight", "bold")
      .text(homeTeamShort + " ");

    // End of sentence
    homeBarChartHeader.append("tspan")
      .text("scoring a given number of goals");

    // Add Matrix Header
    svg.append("text")
      .attr("class", "match-forecasts__bar-header")
      .attr("x", (paddingLeft + barChartSize + gap))
      .attr("y", (svgHeight - (maxGoalDisplay * cellSize)) * .87)
      .attr("font-weight", "bold")
      .text("Final Score Probabilities");

    

  }

  let currentFixtureId = fixtures[0].fixture_id;
  drawMatchForecast(currentFixtureId);

  const container = document.querySelector(".match-forecasts-container");

  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      if (entry.contentBoxSize) {
        drawMatchForecast(currentFixtureId); 
      }
    }
  });

  resizeObserver.observe(container);

  selector.on("change", function () {
    currentFixtureId = +this.value;     
    drawMatchForecast(currentFixtureId);
  });



  

});

