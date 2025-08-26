// Current Season from config json
document.addEventListener("DOMContentLoaded", () => {
  fetch('data/d3_config.json')
    .then(response => response.json())
    .then(config => {

      // Update Season Name in Header
      // const seasonNameSpan = document.querySelector('.season-name');
      // if (seasonNameSpan && config.season) {
      //   seasonNameSpan.textContent = `20${config.season}-${config.season+1} SEASON`;
      // };

      // Update Last Updated Indicator
      const lastUpdatedSpan = document.getElementById('last-updated-text');
      if (lastUpdatedSpan && config.last_updated) {
        // Optional: Format the date nicely (e.g., to "June 28, 2025")
        const date = new Date(config.last_updated);
        const formattedDate = date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        lastUpdatedSpan.textContent = formattedDate;
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

      // Set Active GW
      const activeGWInput = document.getElementById('active-gw-input');
      if (activeGWInput && typeof config.active_gw === 'number') {
        activeGWInput.value = config.active_gw + 1;
      }

      // Set Active GW (Copy)
      const activeGWInputCopy = document.getElementById('active-gw-input-copy');
      if (activeGWInputCopy && typeof config.active_gw === 'number') {
        activeGWInputCopy.value = config.active_gw + 1;
      }

    })
    .catch(error => {
      console.error('Error loading config.json:', error);
    });
});


document.querySelectorAll('.number-input-controls').forEach(wrapper => {
  const inputId = wrapper.dataset.target;
  const input = document.getElementById(inputId);

  const incrementBtn = wrapper.querySelector('.increment');
  const decrementBtn = wrapper.querySelector('.decrement');

  const min = parseInt(input.min, 10) || 1;
  const max = parseInt(input.max, 10) || 100;

  incrementBtn.addEventListener('click', () => {
    let current = parseInt(input.value) || min;
    if (current < max) {
      input.value = current + 1;
      input.dispatchEvent(new Event('input'));
    }
  });

  decrementBtn.addEventListener('click', () => {
    let current = parseInt(input.value) || min;
    if (current > min) {
      input.value = current - 1;
      input.dispatchEvent(new Event('input'));
    }
  });
});





function syncUserInputs(inputId1, inputId2, eventName) {
  const input1 = document.getElementById(inputId1);
  const input2 = document.getElementById(inputId2);

  if (!input1 || !input2) {
    console.warn(`Missing input: ${inputId1} or ${inputId2}`);
    return;
  }

  let syncing = false;

  const syncHandler = (source, target) => {
    source.addEventListener("input", (e) => {
      if (syncing) return;
      syncing = true;

      const value = e.target.value;
      target.value = value;

      const event = new CustomEvent(eventName, { detail: parseInt(value, 10) });
      window.dispatchEvent(event);

      syncing = false;
    });
  };

  syncHandler(input1, input2);
  syncHandler(input2, input1);
}


document.addEventListener("DOMContentLoaded", () => {
  syncUserInputs("active-gw-input", "active-gw-input-copy", "activeGwUpdated");
  syncUserInputs("num-gws-input", "num-gws-input-copy", "numGwsUpdated");
});



