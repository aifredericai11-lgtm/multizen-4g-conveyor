'use strict';

const gmailAuthenticator = require('./gmail_authenticator');
const newsletterWarmer = require('./newsletter_warmer');
const metaPixelWarmer = require('./meta_pixel_warmer');
const batchPlanner = require('./batch_planner');
const emailDomainValidator = require('./email_domain_validator');
const lifecyclePipeline = require('./lifecycle_pipeline');
const profileReelsWarmer = require('./profile_reels_warmer');
const fingerprintGenerator = require('./fingerprint_generator');
const gmailCreator = require('./gmail_creator');
const hubVideoUploader = require('./hub_video_uploader');
const willasPageWarmer = require('./willas_page_warmer');
const {
  runAccountWarmup,
  resolveAccountFromPipeline,
  openYoutubeCreationSlot,
  finalizeCreatedEmailSlot,
  getActiveCreationSlot,
  getActiveNewsletterWarmupState,
  waitForActiveNewsletterWarmup
} = require('./runner');

module.exports = {
  gmailAuthenticator,
  newsletterWarmer,
  metaPixelWarmer,
  emailDomainValidator,
  lifecyclePipeline,
  profileReelsWarmer,
  fingerprintGenerator,
  gmailCreator,
  hubVideoUploader,
  willasPageWarmer,
  ...emailDomainValidator,
  ...lifecyclePipeline,
  ...profileReelsWarmer,
  ...fingerprintGenerator,
  ...gmailCreator,
  ...batchPlanner,
  ...willasPageWarmer,
  runAccountWarmup,
  resolveAccountFromPipeline,
  openYoutubeCreationSlot,
  finalizeCreatedEmailSlot,
  getActiveCreationSlot,
  getActiveNewsletterWarmupState,
  waitForActiveNewsletterWarmup
};
