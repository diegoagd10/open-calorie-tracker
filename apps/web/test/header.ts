import type { Page } from 'playwright'

// The header every logged-in page shares.
export const header = (page: Page) => {
  const banner = page.getByRole('banner')
  return {
    banner: () => banner,
    logo: () => banner.getByText('Open Calorie Tracker'),
    navigation: () => banner.getByRole('navigation', { name: 'Main' }),
    foodLog: () => banner.getByRole('link', { name: 'Food Log' }),
    settings: () => banner.getByRole('link', { name: 'Settings' }),
    logOut: () => banner.getByRole('button', { name: 'Log out' }),
  }
}
