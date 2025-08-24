import sys
from datetime import datetime, timedelta
from improved_cinetpay_scraper import ImprovedCinetPayScraper
from config import Config
import os

def get_date_range():
    """Get date range from user input"""
    print("\n=== Date Range Selection ===")
    print("1. Last 7 days")
    print("2. Last 30 days (default)")
    print("3. Last 90 days")
    print("4. Custom date range")
    
    choice = input("Select an option (1-4, default is 2): ").strip() or "2"
    
    end_date = datetime.now()
    
    if choice == "1":
        start_date = end_date - timedelta(days=7)
    elif choice == "3":
        start_date = end_date - timedelta(days=90)
    elif choice == "4":
        while True:
            try:
                start_date_str = input("Enter start date (YYYY-MM-DD): ").strip()
                start_date = datetime.strptime(start_date_str, "%Y-%m-%d")
                if start_date > end_date:
                    print("Start date cannot be in the future. Please try again.")
                    continue
                break
            except ValueError:
                print("Invalid date format. Please use YYYY-MM-DD format.")
    else:  # Default to 30 days
        start_date = end_date - timedelta(days=30)
    
    return (start_date.strftime("%Y-%m-%d"), end_date.strftime("%Y-%m-%d"))

def main():
    print("=== CinetPay Transaction ID Scraper ===")
    
    # Get date range
    date_range = get_date_range()
    print(f"\nSelected date range: {date_range[0]} to {date_range[1]}")
    
    # Initialize scraper
    scraper = ImprovedCinetPayScraper(headless=False)
    
    try:
        # Login
        print("\n[*] Logging in...")
        scraper.login()
        
        # Navigate to transactions
        print("[*] Navigating to transactions...")
        scraper.navigate_to_transactions()
        
        # Set date filter
        print("[*] Setting date filter...")
        scraper.set_filters(date_range=date_range)
        
        # Scrape all pages
        print("\n[*] Starting to scrape transaction IDs...")
        all_transaction_ids = []
        page_count = 0
        
        while True:
            page_count += 1
            
            # Get pagination info
            pagination_info = scraper.get_pagination_info()
            print(f"[Page {pagination_info['current_page']} of {pagination_info['total_pages']}]")
            
            # Extract transaction IDs from current page
            page_transactions = scraper.extract_table_data()
            all_transaction_ids.extend([tx['transaction_id'] for tx in page_transactions])
            
            print(f"   - Extracted {len(page_transactions)} transaction IDs")
            print(f"   - Total so far: {len(all_transaction_ids)}")
            
            # Check if there's a next page
            if not pagination_info['has_next'] or page_count >= 100:  # Safety limit of 100 pages
                print("   - No more pages available")
                break
            
            # Go to next page
            print("   - Attempting to go to next page...")
            if not scraper.go_to_next_page():
                print("   - Could not navigate to next page")
                break
        
        # Save results
        if all_transaction_ids:
            # Create output directory if it doesn't exist
            os.makedirs(Config.OUTPUT_DIR, exist_ok=True)
            
            # Generate filename with date range
            start_date_str = date_range[0].replace("-", "")
            end_date_str = date_range[1].replace("-", "")
            filename = os.path.join(Config.OUTPUT_DIR, f"transaction_ids_{start_date_str}_{end_date_str}.csv")
            
            # Save as comma-separated values
            with open(filename, 'w') as f:
                f.write(",".join(all_transaction_ids))
            
            print(f"\n[SUCCESS] Saved {len(all_transaction_ids)} transaction IDs to: {filename}")
        else:
            print("\n[WARNING] No transaction IDs found with the current filters.")
            
    except Exception as e:
        print(f"\n[ERROR] An error occurred: {str(e)}")
    finally:
        print("\n[*] Closing browser...")
        scraper.close()

if __name__ == "__main__":
    main()
