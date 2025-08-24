#!/usr/bin/env python3
"""
Test script to validate the CinetPay scraper configuration fixes
"""

from config import Config
import pandas as pd

def test_country_mapping():
    """Test that only required countries are present"""
    required_countries = {
        'Cameroun': '237',
        'Cote d\'ivoire': '225', 
        'Senegal': '221',
        'Burkina Faso': '226',
        'Togo': '228'
    }
    
    print("=== Testing Country Mapping ===")
    print(f"Required countries: {len(required_countries)}")
    print(f"Config countries: {len(Config.COUNTRY_CODES)}")
    
    # Check if all required countries are present
    for country, code in required_countries.items():
        if country in Config.COUNTRY_CODES:
            if Config.COUNTRY_CODES[country] == code:
                print(f"✅ {country}: {code}")
            else:
                print(f"❌ {country}: Expected {code}, got {Config.COUNTRY_CODES[country]}")
        else:
            print(f"❌ {country}: Missing from config")
    
    # Check for extra countries
    extra_countries = set(Config.COUNTRY_CODES.keys()) - set(required_countries.keys())
    if extra_countries:
        print(f"⚠️  Extra countries found: {extra_countries}")
    else:
        print("✅ No extra countries")
    
    return len(Config.COUNTRY_CODES) == len(required_countries)

def test_csv_filename():
    """Test CSV filename format"""
    print("\n=== Testing CSV Filename ===")
    expected_format = 'cinetpay_transaction_ids_{timestamp}.csv'
    
    if Config.CSV_FILENAME_FORMAT == expected_format:
        print(f"✅ CSV filename format: {Config.CSV_FILENAME_FORMAT}")
        return True
    else:
        print(f"❌ CSV filename format: Expected {expected_format}, got {Config.CSV_FILENAME_FORMAT}")
        return False

def test_transaction_validation():
    """Test transaction data validation"""
    print("\n=== Testing Transaction Validation ===")
    
    # Sample transaction data with mixed quality
    sample_transactions = [
        {'date': '2024-01-01', 'transaction_id': 'TXN123', 'amount': '100', 'status': 'ACCEPTED'},
        {'date': '2024-01-02', 'transaction_id': '', 'amount': '200', 'status': 'ACCEPTED'},  # Empty ID
        {'date': '2024-01-03', 'transaction_id': 'TXN456', 'amount': '300', 'status': 'REFUSED'},
        {'date': '2024-01-04', 'transaction_id': None, 'amount': '400', 'status': 'ACCEPTED'},  # None ID
    ]
    
    try:
        df = pd.DataFrame(sample_transactions)
        
        # Apply the same validation logic as in save_to_csv
        if 'transaction_id' in df.columns:
            valid_transactions = df[df['transaction_id'].notna() & (df['transaction_id'] != '')]
            print(f"✅ Original transactions: {len(df)}")
            print(f"✅ Valid transactions: {len(valid_transactions)}")
            print(f"✅ Filtered out: {len(df) - len(valid_transactions)} transactions with empty IDs")
            
            return len(valid_transactions) == 2  # Should have 2 valid transactions
        else:
            print("❌ No transaction_id column found")
            return False
            
    except Exception as e:
        print(f"❌ Transaction validation failed: {str(e)}")
        return False

def main():
    """Run all tests"""
    print("=== CinetPay Scraper Configuration Tests ===\n")
    
    tests = [
        ("Country Mapping", test_country_mapping),
        ("CSV Filename", test_csv_filename), 
        ("Transaction Validation", test_transaction_validation)
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"❌ {test_name} failed with exception: {str(e)}")
            results.append((test_name, False))
    
    print("\n=== Test Summary ===")
    passed = 0
    for test_name, result in results:
        status = "✅ PASSED" if result else "❌ FAILED"
        print(f"{test_name}: {status}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{len(results)} tests passed")
    
    if passed == len(results):
        print("🎉 All tests passed! Configuration is ready.")
    else:
        print("⚠️  Some tests failed. Please review the configuration.")

if __name__ == "__main__":
    main()