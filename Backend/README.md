# NextCampus API

## Overview

NextCampus is a student community and service API for verified university students. It provides a secure, institution-focused place for students to share listings, communicate with other students, ask questions, receive updates, and report inappropriate activity.

The API supports the core experience for both students and authorized platform staff. It is designed as a backend service for web or mobile applications and does not expose or require details about its internal implementation.

## What the API Provides

### Student Accounts

- Registration using a verified student email address
- Secure sign-in and sign-out
- Password recovery and password management
- Student profile information
- Account suspension and restoration

### Community Listings

Students can create and manage listings for five main categories:

- Marketplace
- Lost and found
- Academic support
- Study groups
- Campus services

Listings include titles, descriptions, locations, category-specific details, optional images, and availability status. Public users can search and view eligible listings, while listing owners and authorized staff can manage or moderate them.

### Inquiries

The inquiry system allows students to contact a listing owner privately. Listing owners can accept or decline inquiries, continue conversations, and share contact information only when they choose to do so.

### Notifications

Students receive notifications about important account and community activity, including:

- Inquiry updates
- Listing updates
- Account warnings
- Moderation decisions

### Reports and Moderation

Students can report listings, user profiles, or other inappropriate targets. Authorized moderators and administrators can review reports, take action, warn users, hide or restore listings, and suspend or restore accounts.

### Administration

Administrators can manage users and platform roles, review community activity, and maintain a safe campus environment. Administrative capabilities are restricted to authorized staff.

## Security and Privacy

- Access is limited according to account status and assigned role.
- Student-only features require an authenticated and approved student account.
- Staff features require moderator or administrator authorization.
- User passwords and sensitive session information are protected.
- Public responses include only data appropriate for the requesting user.

## API Use

Applications communicate with NextCampus through standard HTTP requests. Successful responses return structured data, while unsuccessful requests return clear errors that describe whether a request failed due to validation, authentication, authorization, or platform rules.

The API is suitable for:

- Student community web applications
- Mobile applications
- Campus marketplace and services experiences
- Academic support and study-group platforms
- Moderation and administration dashboards
