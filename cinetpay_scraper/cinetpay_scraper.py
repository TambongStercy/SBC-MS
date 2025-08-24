import time
import json
import pandas as pd
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager
from datetime import datetime, timedelta
import logging
from config import Config

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class CinetPayScraper:
    def __init__(self, headless=False):
        """
        Initialize the scraper
        
        Args:
            headless (bool): Whether to run browser in headless mode
        """
        self.driver = None
        self.wait = None
        self.setup_driver(headless)
        
    def setup_driver(self, headless=False):
        """Set up Chrome driver with options"""
        chrome_options = Options()
        
        # Add Chrome options
        for option in Config.CHROME_OPTIONS:
            chrome_options.add_argument(option)
            
        if headless:
            chrome_options.add_argument("--headless")
        
        # Additional stability options
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        try:
            # Automatically download and setup ChromeDriver
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            
            # Execute script to remove webdriver property
            self.driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
            
            self.wait = WebDriverWait(self.driver, Config.WAIT_TIMEOUT)
            logger.info("Chrome driver initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Chrome driver: {str(e)}")
            raise
        
    def login(self, email=None, password=None, login_url=None):
        """
        Login to CinetPay
        
        Args:
            email (str): Login email
            password (str): Login password
            login_url (str): Login page URL
        """
        email = email or Config.EMAIL
        password = password or Config.PASSWORD
        login_url = login_url or Config.LOGIN_URL
        
        try:
            logger.info("Navigating to login page...")
            self.driver.get(login_url)
            
            # Add a small delay to let the page load
            time.sleep(2)
            
            # Wait for and fill email
            logger.info("Looking for email field...")
            email_field = self.wait.until(EC.presence_of_element_located((By.NAME, "email")))
            email_field.clear()
            email_field.send_keys(email)
            logger.info("Email entered")
            
            # Fill password
            logger.info("Looking for password field...")
            password_field = self.driver.find_element(By.NAME, "password")
            password_field.clear()
            password_field.send_keys(password)
            logger.info("Password entered")
            
            # Add small delay before clicking
            time.sleep(1)
            
            # Click login button
            logger.info("Clicking login button...")
            login_button = self.driver.find_element(By.XPATH, "//button[@type='submit']")
            login_button.click()
            
            # Wait for successful login (check for dashboard elements)
            logger.info("Waiting for login to complete...")
            self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "layout-wrapper")))
            logger.info("Login successful!")
            
        except TimeoutException as e:
            logger.error(f"Login failed - timeout waiting for elements: {str(e)}")
            # Take screenshot for debugging
            try:
                screenshot_path = f"login_error_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
                self.driver.save_screenshot(screenshot_path)
                logger.info(f"Screenshot saved to {screenshot_path}")
            except:
                pass
            raise Exception("Login timeout - check credentials or internet connection")
        except NoSuchElementException as e:
            logger.error(f"Login failed - element not found: {str(e)}")
            raise Exception("Login failed - page structure may have changed")
        except Exception as e:
            logger.error(f"Login failed: {str(e)}")
            raise
    
    def navigate_to_transactions(self):
        """Navigate to the transactions page"""
        try:
            # Check if already on transactions page
            current_url = self.driver.current_url
            if "transactions/payments" in current_url:
                logger.info("Already on transactions page")
                return
                
            # Navigate to transactions page
            logger.info("Navigating to transactions page...")
            self.driver.get(Config.TRANSACTIONS_URL)
            
            # Wait for the table to load
            self.wait.until(EC.presence_of_element_located((By.CLASS_NAME, "payments-collected-table")))
            logger.info("Successfully navigated to transactions page")
            
        except Exception as e:
            logger.error(f"Failed to navigate to transactions page: {str(e)}")
            raise
    
    def set_filters(self, country_code=None, status=None, date_range=None, business=None):
        """
        Set filters for the transaction search
        
        Args:
            country_code (str): Country code (e.g., "225" for Cote d'ivoire)
            status (str): Transaction status ("ACCEPTED" for success, "REFUSED" for failure)
            date_range (tuple): Tuple of (start_date, end_date) in "YYYY-MM-DD" format
            business (str): Business ID to filter by
        """
        try:
            logger.info("Setting filters...")
            
            # Set business filter if provided
            if business:
                try:
                    business_select = Select(self.driver.find_element(By.CSS_SELECTOR, "select[wire\\:model\\.defer='business']"))
                    business_select.select_by_value(business)
                    logger.info(f"Selected business: {business}")
                except Exception as e:
                    logger.warning(f"Could not set business filter: {str(e)}")
            
            # Set country filter if provided
            if country_code:
                try:
                    country_select = Select(self.driver.find_element(By.CSS_SELECTOR, "select[wire\\:model\\.defer='country']"))
                    country_select.select_by_value(country_code)
                    logger.info(f"Selected country code: {country_code}")
                except Exception as e:
                    logger.warning(f"Could not set country filter: {str(e)}")
            
            # Set status filter if provided
            if status:
                try:
                    status_select = Select(self.driver.find_element(By.CSS_SELECTOR, "select[wire\\:model\\.lazy='status']"))
                    status_select.select_by_value(status)
                    logger.info(f"Selected status: {status}")
                except Exception as e:
                    logger.warning(f"Could not set status filter: {str(e)}")
            
            # Set date range if provided
            if date_range:
                try:
                    start_date, end_date = date_range
                    date_input = self.driver.find_element(By.CSS_SELECTOR, "input[wire\\:model\\.lazy='date']")
                    date_input.clear()
                    date_input.send_keys(f"{start_date} - {end_date}")
                    logger.info(f"Set date range: {start_date} to {end_date}")
                except Exception as e:
                    logger.warning(f"Could not set date range: {str(e)}")
            
            # Click the validation button to apply filters
            try:
                validate_button = self.driver.find_element(By.CSS_SELECTOR, "button[type='submit']")
                validate_button.click()
                logger.info("Applied filters")
                
                # Wait for the table to update
                time.sleep(3)
                self.wait_for_table_load()
            except Exception as e:
                logger.warning(f"Could not apply filters: {str(e)}")
            
        except Exception as e:
            logger.error(f"Failed to set filters: {str(e)}")
            raise
    
    def wait_for_table_load(self):
        """Wait for the table to finish loading with improved logic"""
        try:
            # First, wait for any loader to disappear
            try:
                WebDriverWait(self.driver, 3).until(
                    EC.invisibility_of_element_located((By.ID, "loader"))
                )
            except TimeoutException:
                pass  # Loader might not be present
            
            # Wait for table rows to be present and stable
            self.wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, ".payments-collected-table tbody tr")))
            
            # Additional wait for dynamic content to stabilize
            time.sleep(1)
            
            # Verify we have actual data rows (not just loading placeholders)
            rows = self.driver.find_elements(By.CSS_SELECTOR, ".payments-collected-table tbody tr")
            if len(rows) == 0:
                logger.warning("No table rows found after waiting")
                return False
            
            # Check if first row has actual data (not loading text)
            first_row_text = rows[0].text.strip()
            if "loading" in first_row_text.lower() or first_row_text == "":
                logger.info("Table still loading, waiting longer...")
                time.sleep(2)
            
            return True
            
        except TimeoutException:
            logger.warning("Timeout waiting for table to load")
            return False
        except Exception as e:
            logger.error(f"Error waiting for table load: {str(e)}")
            return False
    
    def extract_table_data(self):
        """Extract data from the current page of the table"""
        transactions = []
        
        try:
            # Find all transaction rows
            rows = self.driver.find_elements(By.CSS_SELECTOR, ".payments-collected-table tbody tr")
            
            for row in rows:
                try:
                    cells = row.find_elements(By.TAG_NAME, "td")
                    if len(cells) >= 5:  # Ensure we have enough columns
                        # Extract basic data - ensure transaction ID is not empty
                        transaction_id = cells[1].text.strip()
                        if not transaction_id:
                            logger.warning(f"Empty transaction ID found, skipping row")
                            continue
                            
                        transaction = {
                            'date': cells[0].text.strip(),
                            'transaction_id': transaction_id,
                            'phone_number': cells[2].text.strip(),
                            'amount': cells[3].text.strip(),
                            'status': cells[4].text.strip(),
                        }
                        
                        # Extract additional data from the action button if available
                        try:
                            action_link = row.find_element(By.CSS_SELECTOR, ".payment-action")
                            data_json = action_link.get_attribute("data-json")
                            business_name = action_link.get_attribute("data-business-name")
                            
                            if data_json:
                                payment_data = json.loads(data_json)
                                transaction.update({
                                    'payment_method': payment_data.get('payment_method', ''),
                                    'currency': payment_data.get('cpm_currency', ''),
                                    'error_message': payment_data.get('cpm_error_message', ''),
                                    'business_id': payment_data.get('cpm_site_id', ''),
                                    'business_name': business_name or '',
                                    'operator_id': payment_data.get('cpm_payid', ''),
                                    'phone_prefix': payment_data.get('cpm_phone_prefixe', ''),
                                    'designation': payment_data.get('cpm_designation', ''),
                                    'payment_config': payment_data.get('cpm_payment_config', ''),
                                    'notify_url': payment_data.get('notify_url', ''),
                                    'custom_field': payment_data.get('custom_s3', ''),
                                })
                        except (NoSuchElementException, json.JSONDecodeError) as e:
                            logger.debug(f"Could not extract additional data from row: {str(e)}")
                        
                        transactions.append(transaction)
                        
                except Exception as e:
                    logger.warning(f"Failed to extract data from row: {str(e)}")
                    continue
            
            logger.info(f"Extracted {len(transactions)} transactions from current page")
            return transactions
            
        except Exception as e:
            logger.error(f"Failed to extract table data: {str(e)}")
            return []
    
    def get_pagination_info(self):
        """Get information about pagination"""
        try:
            # Get current page number
            current_page_element = self.driver.find_element(By.CSS_SELECTOR, ".pagination .page-item.active .page-link")
            current_page = int(current_page_element.text)
            
            # Get total pages (look for the last page number)
            page_links = self.driver.find_elements(By.CSS_SELECTOR, ".pagination .page-item .page-link")
            total_pages = 1
            for link in page_links:
                try:
                    page_num = int(link.text)
                    total_pages = max(total_pages, page_num)
                except ValueError:
                    continue
            
            # Check if next page is available
            next_buttons = self.driver.find_elements(By.CSS_SELECTOR, ".pagination .page-item:last-child")
            has_next = len(next_buttons) > 0 and "disabled" not in next_buttons[0].get_attribute("class")
            
            return {
                'current_page': current_page,
                'total_pages': total_pages,
                'has_next': has_next
            }
            
        except Exception as e:
            logger.warning(f"Could not get pagination info: {str(e)}")
            return {'current_page': 1, 'total_pages': 1, 'has_next': False}
    
    def go_to_next_page(self):
        """Navigate to the next page with improved error handling"""
        try:
            # Try multiple selectors for next button
            next_selectors = [
                ".pagination .page-item:last-child button",
                ".pagination .page-item:last-child a",
                "a[rel='next']",
                "button[wire\\:click*='nextPage']"
            ]
            
            next_button = None
            for selector in next_selectors:
                try:
                    next_button = self.driver.find_element(By.CSS_SELECTOR, selector)
                    break
                except NoSuchElementException:
                    continue
            
            if not next_button:
                logger.warning("No next button found with any selector")
                return False
            
            # Check if button is disabled
            parent_li = next_button.find_element(By.XPATH, "..")
            if "disabled" in parent_li.get_attribute("class"):
                logger.info("Next button is disabled - reached last page")
                return False
            
            # Scroll to button and click
            self.driver.execute_script("arguments[0].scrollIntoView(true);", next_button)
            time.sleep(0.5)
            
            # Try clicking with JavaScript if regular click fails
            try:
                next_button.click()
            except Exception:
                logger.info("Regular click failed, trying JavaScript click")
                self.driver.execute_script("arguments[0].click();", next_button)
            
            # Wait for page to load
            self.wait_for_table_load()
            time.sleep(1)  # Additional stability delay
            return True
            
        except Exception as e:
            logger.error(f"Failed to go to next page: {str(e)}")
            return False
    
    def scrape_all_pages(self, max_pages=None):
        """
        Scrape data from all pages
        
        Args:
            max_pages (int): Maximum number of pages to scrape (None for all)
        
        Returns:
            list: All transactions from all pages
        """
        all_transactions = []
        page_count = 0
        
        while True:
            page_count += 1
            
            # Check max_pages limit
            if max_pages and page_count > max_pages:
                logger.info(f"Reached maximum page limit: {max_pages}")
                break
            
            # Get pagination info
            pagination_info = self.get_pagination_info()
            logger.info(f"Scraping page {pagination_info['current_page']} of {pagination_info['total_pages']}")
            
            # Extract data from current page
            page_transactions = self.extract_table_data()
            all_transactions.extend(page_transactions)
            
            # Check if there's a next page
            if not pagination_info['has_next']:
                logger.info("Reached last page")
                break
            
            # Go to next page
            if not self.go_to_next_page():
                logger.info("Could not navigate to next page")
                break
            
            # Small delay to be respectful to the server
            time.sleep(Config.PAGE_DELAY)
        
        logger.info(f"Total transactions scraped: {len(all_transactions)}")
        return all_transactions
    
    def save_to_csv(self, transactions, filename=None):
        """Save transactions to CSV file"""
        if not transactions:
            logger.warning("No transactions to save")
            return None
            
        if not filename:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = Config.CSV_FILENAME_FORMAT.format(timestamp=timestamp)
        
        # Create output directory if it doesn't exist
        import os
        os.makedirs(Config.OUTPUT_DIR, exist_ok=True)
        
        # Full path for the file
        full_path = os.path.join(Config.OUTPUT_DIR, filename)
        
        try:
            df = pd.DataFrame(transactions)
            
            # Validate that we have transaction IDs
            if 'transaction_id' in df.columns:
                valid_transactions = df[df['transaction_id'].notna() & (df['transaction_id'] != '')]
                if len(valid_transactions) == 0:
                    logger.error("No valid transaction IDs found in data")
                    return None
                elif len(valid_transactions) < len(df):
                    logger.warning(f"Filtered out {len(df) - len(valid_transactions)} transactions with empty IDs")
                    df = valid_transactions
            
            df.to_csv(full_path, index=False)
            logger.info(f"Data saved to {full_path} ({len(df)} transactions)")
            return full_path
        except Exception as e:
            logger.error(f"Failed to save CSV file: {str(e)}")
            return None
    
    def get_summary_stats(self, transactions):
        """Get summary statistics of scraped transactions"""
        if not transactions:
            return {}
        
        df = pd.DataFrame(transactions)
        
        stats = {
            'total_transactions': len(transactions),
            'date_range': f"{df['date'].min()} to {df['date'].max()}" if 'date' in df.columns else 'N/A',
        }
        
        # Status breakdown
        if 'status' in df.columns:
            status_counts = df['status'].value_counts().to_dict()
            stats['status_breakdown'] = status_counts
        
        # Payment method breakdown
        if 'payment_method' in df.columns:
            payment_methods = df['payment_method'].value_counts().to_dict()
            stats['payment_methods'] = payment_methods
        
        # Currency breakdown
        if 'currency' in df.columns:
            currencies = df['currency'].value_counts().to_dict()
            stats['currencies'] = currencies
        
        return stats
    
    def close(self):
        """Close the browser"""
        if self.driver:
            self.driver.quit()
            logger.info("Browser closed")