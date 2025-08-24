# Enhanced CinetPay Transaction ID Scraper - Quick Start Guide

This enhanced scraper is specifically designed to extract **ID Transaction Client** from CinetPay payout transactions with advanced filtering capabilities.

## What It Does

✅ **Extracts Transaction IDs**: Focuses only on "ID Transaction Client" (the transaction IDs)
✅ **Date Range Filtering**: Filter transactions by date range (even though the page doesn't have it)
✅ **Status Filtering**: Filter by successful/failed transactions
✅ **Country Filtering**: Filter by specific countries
✅ **Pagination Support**: Automatically handles multiple pages
✅ **CSV Export**: Clean output with transaction IDs only

## Quick Start

### 1. Set Credentials

**Windows:**
```cmd
set CINETPAY_EMAIL=your_actual_email@example.com
set CINETPAY_PASSWORD=your_actual_password
```

**Mac/Linux:**
```bash
export CINETPAY_EMAIL='your_actual_email@example.com'
export CINETPAY_PASSWORD='your_actual_password'
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Test Setup

```bash
python test_enhanced_scraper.py
```

### 4. Run the Scraper

**Interactive Mode (Recommended):**
```bash
python enhanced_transaction_id_scraper.py
```

**Quick Run Script:**
```bash
python run_enhanced_scraper.py
```

## Usage Examples

### Example 1: Scrape Last 30 Days (Default)

```bash
python enhanced_transaction_id_scraper.py
# Then choose option 2 for "Last 30 days"
```

### Example 2: Custom Date Range

```bash
python enhanced_transaction_id_scraper.py
# Choose option 4 for "Custom date range"
# Enter: 2025-01-01
# Enter: 2025-01-31
```

### Example 3: Successful Transactions Only

```bash
python enhanced_transaction_id_scraper.py
# Choose option 2 for "Successful only"
```

## Output

The scraper saves results to: `scraped_data/enhanced_transaction_ids_YYYYMMDD_HHMMSS.csv`

Example output:
```csv
transaction_id
j9c9YX2f10FX
diYCQoX8xCSe
rytFiLhDDrj3
Fy-y-5OyuSsb
```

## Filter Options

### Date Ranges
1. **Last 7 days** - Past week
2. **Last 30 days** (default) - Past month
3. **Last 90 days** - Past 3 months
4. **Custom date range** - Specify exact dates

### Countries
1. **Cote d'Ivoire (CI)** (default)
2. **Cameroon (CM)**
3. **Senegal (SN)**
4. **Burkina Faso (BF)**
5. **Togo (TG)**
6. **All countries** (scrapes each country individually)

### Transaction Status
1. **All transactions** (default)
2. **Successful only** - ACCEPTED status
3. **Failed only** - REFUSED status

### Additional Options
- **Maximum pages**: Limit pages to scrape (default: all)
- **Headless mode**: Run without browser window (default: no)

## Advanced Usage

### Programmatic Usage

```python
from enhanced_transaction_id_scraper import EnhancedTransactionIDScraper

# Initialize scraper
scraper = EnhancedTransactionIDScraper(headless=True)

try:
    # Login and navigate
    scraper.login()
    scraper.navigate_to_payout_search()

    # Set filters
    scraper.set_date_filter("2025-01-01", "2025-01-31")
    scraper.set_country_filter("225")  # Cote d'Ivoire
    scraper.set_status_filter("success")  # Successful only

    # Apply filters and scrape
    scraper.search_transactions()
    transaction_ids = scraper.scrape_all_pages(max_pages=5)

    # Save results
    if transaction_ids:
        filename = scraper.save_transaction_ids(
            transaction_ids,
            "scraped_data/my_transaction_ids.csv"
        )
        print(f"Saved {len(transaction_ids)} IDs to {filename}")

finally:
    scraper.close()
```

## Troubleshooting

### Common Issues

**❌ "Login failed"**
- Check credentials
- Verify internet connection
- Ensure account is active

**❌ "No transactions found"**
- Adjust date range
- Check country selection
- Verify transactions exist for selected filters

**❌ "Chrome driver issues"**
```bash
python test_enhanced_scraper.py
```

**❌ "Element not found"**
- Website may have changed
- Try headless mode
- Update selectors in the code

### Error Recovery

1. **Test first**: `python test_enhanced_scraper.py`
2. **Check logs**: Look for detailed error messages
3. **Try headless**: Set headless=True for stability
4. **Limit pages**: Set max_pages=1 for testing

## Performance Tips

- **Use headless mode** for faster scraping
- **Limit pages** for testing (`max_pages=5`)
- **Filter early** to reduce data volume
- **Check internet connection** stability

## File Structure

```
cinetpay_scraper/
├── enhanced_transaction_id_scraper.py  # Main enhanced scraper
├── run_enhanced_scraper.py            # Quick run script
├── test_enhanced_scraper.py           # Test suite
├── ENHANCED_SCRAPER_QUICK_START.md    # This guide
├── scraped_data/                      # Output directory
└── requirements.txt                   # Dependencies
```

## Support

For issues:
1. Run the test suite: `python test_enhanced_scraper.py`
2. Check this guide
3. Review error messages
4. Try with different filter combinations

## Security Notes

- Never commit credentials to version control
- Use environment variables for credentials
- Run in secure environments only
- Respect CinetPay's terms of service
