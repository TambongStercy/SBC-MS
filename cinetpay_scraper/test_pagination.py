# test_pagination.py
"""
Test script to verify pagination is working correctly
"""
from config import Config
from improved_cinetpay_scraper import ImprovedCinetPayScraper

def test_pagination():
    """Test pagination on a single country"""
    print("=== Testing Pagination Fix ===")
    
    # Get credentials from config
    email = Config.EMAIL
    password = Config.PASSWORD
    
    print("\nTesting pagination with Cameroun (should have multiple pages)")
    
    scraper = ImprovedCinetPayScraper(headless=False)
    
    try:
        # Login
        print("[*] Logging in...")
        scraper.login(email, password)
        
        # Navigate to transactions
        print("[*] Navigating to transactions...")
        scraper.navigate_to_transactions()
        
        # Test with Cameroun (code 237) - limit to 3 pages for testing
        print("[*] Setting filters for Cameroun...")
        scraper.set_filters(
            country_code="237",  # Cameroun
            status="ACCEPTED",   # Successful only
            date_range=Config.get_default_date_range()
        )
        
        print("[*] Testing pagination (max 3 pages)...")
        
        all_transactions = []
        page_count = 0
        max_test_pages = 3
        
        while page_count < max_test_pages:
            page_count += 1
            
            # Get pagination info
            pagination_info = scraper.get_pagination_info()
            print(f"[Page {pagination_info['current_page']} of {pagination_info['total_pages']}]")
            
            # Extract data
            page_transactions = scraper.extract_table_data()
            all_transactions.extend(page_transactions)
            
            print(f"   - Extracted {len(page_transactions)} transactions")
            print(f"   - Total so far: {len(all_transactions)}")
            
            # Check if there's a next page
            if not pagination_info['has_next']:
                print("   - No more pages available")
                break
            
            # Try to go to next page
            print("   - Attempting to go to next page...")
            if scraper.go_to_next_page():
                print("   [OK] Successfully navigated to next page")
            else:
                print("   [ERROR] Failed to navigate to next page")
                break
        
        print(f"\n=== Pagination Test Results ===")
        print(f"[INFO] Total pages tested: {page_count}")
        print(f"[INFO] Total transactions: {len(all_transactions)}")
        print(f"[INFO] Average per page: {len(all_transactions)/page_count:.1f}")
        
        if len(all_transactions) > 10:  # Should have more than one page worth
            print("[SUCCESS] Pagination appears to be working!")
        else:
            print("[WARNING] Pagination may not be working properly")
        
        # Save test results
        if all_transactions:
            filename = scraper.save_to_csv(all_transactions, "pagination_test_results.csv")
            print(f"[INFO] Test data saved to: {filename}")
        
    except Exception as e:
        print(f"[ERROR] Test failed: {str(e)}")
    finally:
        scraper.close()

if __name__ == "__main__":
    test_pagination()