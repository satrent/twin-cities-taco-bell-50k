const form = document.getElementById('register');
const formError = document.getElementById('form-error');
const submit = document.getElementById('submit');

function fillSelect(name, options) {
  const select = form.elements[name];
  select.append(new Option('Choose...', ''));
  options.forEach((option) => select.append(new Option(option, option)));
}

window.eventInfo
  .then((info) => {
    const spotsText = document.querySelector('[data-spots-text]');
    if (info.status === 'soon') {
      spotsText.textContent = 'Registration opens soon';
      document.getElementById('closed-title').textContent = 'Registration opens soon!';
      document.getElementById('closed-text').textContent = "Leave your email and we'll let you know the moment it opens.";
      document.getElementById('closed').hidden = false;
      return;
    }
    if (info.status === 'closed') {
      spotsText.textContent = 'Registration closed';
      document.getElementById('closed').hidden = false;
      return;
    }
    spotsText.textContent = info.status === 'waitlist' ? 'Waitlist only' : `${info.spotsLeft} spots left`;
    document.getElementById('waitlist-banner').hidden = info.status !== 'waitlist';
    if (info.status === 'waitlist') submit.textContent = 'Join the waitlist';
    fillSelect('category', info.options.categories);
    fillSelect('shirt_size', info.options.shirtSizes);
    fillSelect('diet', info.options.diets);
    form.hidden = false;
  })
  .catch(() => {
    document.querySelector('.form-head').insertAdjacentHTML(
      'afterend',
      '<p class="banner">We couldn\'t load registration. Please refresh the page to try again.</p>'
    );
  });

function clearErrors() {
  form.querySelectorAll('.field-error').forEach((el) => el.remove());
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  formError.hidden = true;
}

function showFieldError(name, message) {
  const field = form.elements[name];
  if (!field) return;
  field.setAttribute('aria-invalid', 'true');
  const note = document.createElement('span');
  note.className = 'field-error';
  note.textContent = message;
  field.closest('label').append(note);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const body = Object.fromEntries(new FormData(form));
  body.is_adult = form.elements.is_adult.checked;
  body.waiver_accepted = form.elements.waiver_accepted.checked;

  const label = submit.textContent;
  submit.disabled = true;
  submit.textContent = 'Saving...';
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      Object.entries(data.errors || {}).forEach(([name, message]) => showFieldError(name, message));
      formError.textContent = data.error;
      formError.hidden = false;
      const firstBad = form.querySelector('[aria-invalid]');
      (firstBad || formError).focus?.();
      return;
    }

    const onWaitlist = data.status === 'waitlist';
    document.getElementById('done-title').textContent = onWaitlist
      ? `You're on the waitlist, ${data.firstName}!`
      : `You're in, ${data.firstName}!`;
    document.getElementById('done-code').textContent = data.code;
    document.getElementById('done-next').textContent = onWaitlist
      ? "We'll reach out if a spot opens. You don't need to pay anything yet."
      : `Registration fee: $${data.fee}. ${data.paymentInstructions}`;
    form.hidden = true;
    document.getElementById('waitlist-banner').hidden = true;
    const done = document.getElementById('done');
    done.hidden = false;
    done.focus();
    window.scrollTo(0, 0);
  } catch {
    formError.textContent = "We couldn't reach the server. Your info is still here, so please try again.";
    formError.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = label;
  }
});

const notifyForm = document.getElementById('notify');
notifyForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const error = document.getElementById('notify-error');
  error.hidden = true;
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(notifyForm)))
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    notifyForm.hidden = true;
    document.getElementById('notify-done').hidden = false;
  } catch (err) {
    error.textContent = err.message || "We couldn't reach the server. Please try again.";
    error.hidden = false;
  }
});
