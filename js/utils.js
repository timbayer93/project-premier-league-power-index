// Get Team Logo URL from Team Code
function getTeamLogoURL(teamCode) {
  // TODO: make size dynamic
  return `https://resources.premierleague.com/premierleague/badges/100/t${teamCode}@x2.png`
};

// Color constants using d3.rgb
const COLORS = {
  green: d3.rgb("rgb(0, 255, 133)"),
  grey: d3.rgb("rgb(192, 192, 192)"),
  purple: d3.rgb("rgb(56, 0, 60)"),
};

// Find Text Colour based on BG colour to maximise contrast
function getTextColor(backgroundColor) {
  const c = d3.color(backgroundColor);
  if (!c) return "black"; // fallback

  // Calculate luminance (perceived brightness)
  // Formula from WCAG: https://www.w3.org/TR/WCAG20/#relativeluminancedef
  const rgb = [c.r, c.g, c.b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });

  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

  return luminance > 0.279 ? "black" : "white";
};


const interp1 = d3.interpolateRgb(COLORS.green, COLORS.grey);
const interp2 = d3.interpolateRgb(COLORS.grey, COLORS.purple);

// Generates a color scale that transitions from green → grey → purple based on Elo values
function customDivergingInterpolatorGreenPurple(t) {
  return t < 0.5 ? interp1(t * 2) : interp2((t - 0.5) * 2);
}

// Set colour of dot for last updated
const lastUpdatedText = document.getElementById('last-updated-text').innerText;
const updateIndicator = document.getElementById('update-indicator');

const lastDate = new Date(lastUpdatedText + ' 00:00:00');
const today = new Date();
const diffInDays = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));

if (diffInDays <= 2) {
  updateIndicator.style.backgroundColor = '#2ecc71'; // green
} else if (diffInDays <= 7) {
  updateIndicator.style.backgroundColor = '#f39c12'; // orange
} else {
  updateIndicator.style.backgroundColor = '#e74c3c'; // red
}


// Current Season from config json
document.addEventListener("DOMContentLoaded", () => {
  fetch('data/config.json')
    .then(response => response.json())
    .then(config => {
      // Update season name in header
      const seasonNameSpan = document.querySelector('.season-name');
      if (seasonNameSpan && config.season) {
        seasonNameSpan.textContent = `20${config.season}-${config.season+1} SEASON`;
      }
    })
    .catch(error => {
      console.error('Error loading config.json:', error);
    });
});
