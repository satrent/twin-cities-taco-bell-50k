// Fills in the event details an organizer can change from Admin > Settings.
window.eventInfo = fetch('/api/public')
  .then((res) => (res.ok ? res.json() : Promise.reject(res)))
  .then((info) => {
    document.querySelectorAll('[data-bind]').forEach((el) => {
      const value = info[el.dataset.bind];
      if (value !== undefined) el.textContent = value;
    });

    const label = { open: 'Register now', waitlist: 'Join the waitlist', soon: 'Get notified', closed: 'Get notified' }[info.status];
    document.querySelectorAll('[data-cta]').forEach((el) => {
      el.textContent = el.classList.contains('nav-cta') && info.status === 'open' ? 'Register' : label;
    });

    const spots = document.querySelector('[data-spots]');
    if (spots) {
      if (info.status === 'open' && info.spotsLeft <= 25) {
        spots.textContent = `Only ${info.spotsLeft} ${info.spotsLeft === 1 ? 'spot' : 'spots'} left`;
        spots.hidden = false;
      } else if (info.status === 'waitlist') {
        spots.textContent = 'Sold out. Waitlist open.';
        spots.hidden = false;
      } else if (info.status === 'soon') {
        spots.textContent = 'Registration opens soon';
        spots.hidden = false;
      }
    }
    return info;
  });
