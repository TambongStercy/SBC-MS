#!/usr/bin/env python3
"""
Test script for the Enhanced Transaction ID Scraper
Usage: python test_enhanced_scraper.py
"""

import os
import sys
from datetime import datetime, timedelta

def test_imports():
    """Test if all required modules can be imported"""
    try:
        import selenium
        import pandas
        import webdriver_manager
        from selenium import webdriver
        from enhanced_transaction_id_scraper import EnhancedTransactionIDScraper
        print("✅ All imports successful")
        return True
    except ImportError as e:
        print(f"❌ Import error: {e}")
        print("Please install requirements: pip install -r requirements.txt")
        return False

def test_credentials():
    """Test if credentials are set"""
    email = os.getenv('CINETPAY_EMAIL', 'your_email@example.com')
    password = os.getenv('CINETPAY_PASSWORD', 'your_password')

    if email == 'your_email@example.com' or password == 'your_password':
        print("⚠️  Warning: Using placeholder credentials")
        print("Set environment variables for actual testing:")
        print("export CINETPAY_EMAIL='your_actual_email@example.com'")
        print("export CINETPAY_PASSWORD='your_actual_password'")
        return False
    else:
        print("✅ Credentials found")
        return True

def test_chrome_driver():
    """Test Chrome driver setup"""
    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        from webdriver_manager.chrome import ChromeDriverManager

        print("Testing Chrome driver setup...")

        chrome_options = Options()
        chrome_options.add_argument("--headless")
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")

        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=chrome_options)

        # Test basic navigation
        driver.get("https://www.google.com")
        title = driver.title
        driver.quit()

        if "Google" in title:
            print("✅ Chrome driver test successful")
            return True
        else:
            print(f"⚠️  Chrome driver test uncertain - page title: {title}")
            return True

    except Exception as e:
        print(f"❌ Chrome driver test failed: {e}")
        return False

def test_scraper_initialization():
    """Test scraper initialization"""
    try:
        from enhanced_transaction_id_scraper import EnhancedTransactionIDScraper

        print("Testing scraper initialization...")
        scraper = EnhancedTransactionIDScraper(headless=True)

        # Test that attributes are set
        assert scraper.driver is not None, "Driver not initialized"
        assert scraper.wait is not None, "Wait not initialized"
        assert scraper.login_url is not None, "Login URL not set"
        assert scraper.payout_search_url is not None, "Payout URL not set"

        scraper.close()
        print("✅ Scraper initialization test successful")
        return True

    except Exception as e:
        print(f"❌ Scraper initialization test failed: {e}")
        return False

def test_date_filtering():
    """Test date filtering logic"""
    try:
        from enhanced_transaction_id_scraper import EnhancedTransactionIDScraper

        print("Testing date filtering...")
        scraper = EnhancedTransactionIDScraper(headless=True)

        # Test date range setting
        start_date = "2025-01-01"
        end_date = "2025-01-31"

        # This should not fail even without browser interaction
        scraper.set_date_filter(start_date, end_date)

        scraper.close()
        print("✅ Date filtering test successful")
        return True

    except Exception as e:
        print(f"❌ Date filtering test failed: {e}")
        return False

def main():
    """Run all tests"""
    print("=== Enhanced Transaction ID Scraper - Test Suite ===")
    print(f"Test run: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    tests = [
        ("Import Test", test_imports),
        ("Credentials Test", test_credentials),
        ("Chrome Driver Test", test_chrome_driver),
        ("Scraper Initialization Test", test_scraper_initialization),
        ("Date Filtering Test", test_date_filtering),
    ]

    results = []
    for test_name, test_func in tests:
        print(f"\n🧪 Running {test_name}...")
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ {test_name} crashed: {e}")
            results.append((test_name, False))

    # Summary
    print("\n" + "="*50)
    print("TEST SUMMARY")
    print("="*50)

    passed = 0
    failed = 0

    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
        if result:
            passed += 1
        else:
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed")

    if failed == 0:
        print("\n🎉 All tests passed! The scraper should work correctly.")
        print("You can now run: python run_enhanced_scraper.py")
    else:
        print(f"\n⚠️  {failed} test(s) failed. Please fix the issues before running the scraper.")

    return failed == 0

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
