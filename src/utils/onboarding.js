// src/utils/onboarding.js

/**
 * Extract the onboarding token from a URL or query string.
 * @param {string} urlOrSearch - Full URL or search string (e.g., '?token=abc')
 * @returns {string|null}
 */
export function parseOnboardingToken(urlOrSearch) {
  try {
    const search = urlOrSearch.includes('?') ? urlOrSearch.slice(urlOrSearch.indexOf('?')) : urlOrSearch;
    const params = new URLSearchParams(search);
    return params.get('token');
  } catch {
    return null;
  }
}

/**
 * Validate the onboarding form fields.
 * @param {Object} form
 * @returns {Object} errors — keys are field names, values are error strings. Empty if valid.
 */
export function validateOnboardingForm(form) {
  const errors = {};
  if (!form.business_name?.trim()) errors.business_name = 'Business name is required';
  if (!form.address?.trim())       errors.address       = 'Street address is required';
  if (!form.city?.trim())          errors.city          = 'City is required';
  if (!form.province?.trim())      errors.province      = 'Province / State is required';
  if (!form.services?.trim())      errors.services      = 'Please describe your services';
  return errors;
}
