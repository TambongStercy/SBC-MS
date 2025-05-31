# Contact Export Filtering Guide

This guide shows how to use query parameters to filter contact exports in the SBC user service.

## How Filtering Works

The contact export endpoint uses a **smart hybrid approach**:

- **No filters** → Blazingly fast cached VCF file (milliseconds)
- **With filters** → Dynamic generation with full filtering support (seconds)

## Endpoint

```
GET /api/contacts/export
```

## Available Filters

### 1. Geographic Filters

#### Country Filter
```bash
GET /api/contacts/export?country=Cameroon
GET /api/contacts/export?country=Nigeria
```

#### Region Filter
```bash
GET /api/contacts/export?region=Centre
GET /api/contacts/export?region=Lagos
```

#### City Filter
```bash
GET /api/contacts/export?city=Yaoundé
GET /api/contacts/export?city=Douala
```

#### Combined Geographic
```bash
GET /api/contacts/export?country=Cameroon&region=Centre&city=Yaoundé
```

### 2. Demographic Filters

#### Gender Filter
```bash
GET /api/contacts/export?sex=male
GET /api/contacts/export?sex=female
```

#### Age Range Filter
```bash
# Users between 25 and 35 years old
GET /api/contacts/export?minAge=25&maxAge=35

# Users 18 and older
GET /api/contacts/export?minAge=18

# Users under 30
GET /api/contacts/export?maxAge=30
```

#### Language Filter
```bash
GET /api/contacts/export?language=French
GET /api/contacts/export?language=English
```

### 3. Professional Filters

#### Profession Filter
```bash
GET /api/contacts/export?profession=Engineer
GET /api/contacts/export?profession=Teacher
GET /api/contacts/export?profession=Doctor
```

### 4. Interest-Based Filters

#### Single Interest
```bash
GET /api/contacts/export?interests=Technology
GET /api/contacts/export?interests=Sports
```

#### Multiple Interests
```bash
GET /api/contacts/export?interests=Technology&interests=Business
GET /api/contacts/export?interests[]=Technology&interests[]=Sports
```

### 5. Registration Date Filters

#### Date Range
```bash
# Users registered in 2024
GET /api/contacts/export?startDate=2024-01-01&endDate=2024-12-31

# Users registered in the last 30 days
GET /api/contacts/export?startDate=2024-11-01

# Users registered before a specific date
GET /api/contacts/export?endDate=2024-10-31
```

#### Alternative Date Format
```bash
GET /api/contacts/export?registrationDateStart=2024-01-01&registrationDateEnd=2024-12-31
```

## Complex Filter Combinations

### Example 1: Young Tech Professionals in Cameroon
```bash
GET /api/contacts/export?country=Cameroon&minAge=22&maxAge=35&interests=Technology&profession=Engineer
```

### Example 2: French-Speaking Women in Business
```bash
GET /api/contacts/export?language=French&sex=female&interests=Business
```

### Example 3: Recent Registrations in Specific Region
```bash
GET /api/contacts/export?region=Centre&startDate=2024-11-01&profession=Teacher
```

### Example 4: Multi-Interest Targeting
```bash
GET /api/contacts/export?country=Nigeria&interests=Technology&interests=Business&interests=Finance&minAge=25
```

## Subscription-Based Access Control

### CLASSIQUE Subscription
- **Allowed filters**: `country` only
- **Example**:
  ```bash
  GET /api/contacts/export?country=Cameroon  # ✅ Allowed
  GET /api/contacts/export?country=Cameroon&sex=male  # ❌ Forbidden
  ```

### CIBLE Subscription
- **Allowed filters**: All filters available
- **Example**:
  ```bash
  GET /api/contacts/export?country=Cameroon&sex=male&minAge=25&profession=Engineer  # ✅ Allowed
  ```

## Response Format

All filtered exports return VCF files with additional metadata based on applied filters:

```vcard
BEGIN:VCARD
VERSION:3.0
FN;CHARSET=UTF-8:John Doe SBC
N;CHARSET=UTF-8:;John Doe SBC;;;
UID;CHARSET=UTF-8:507f1f77bcf86cd799439011
TEL;TYPE=CELL:+237123456789
EMAIL;CHARSET=UTF-8:john.doe@example.com
X-COUNTRY:Cameroon
X-REGION:Centre
X-CITY:Yaoundé
GENDER:M
BDAY:1990-05-15
LANG:French
TITLE:Software Engineer
CATEGORIES:Technology,Business
REV:2024-01-15T10:30:00.000Z
END:VCARD
```

## Performance Considerations

### Fast (Cached) Exports
```bash
# No filters - served from cache (50-200ms)
GET /api/contacts/export
```

### Popular Filter Cache (NEW!)
```bash
# Popular filter combinations - served from cache (100-500ms)
GET /api/contacts/export?country=Cameroon  # Cached after first use
GET /api/contacts/export?sex=male&minAge=25&maxAge=35  # Cached after first use
```

### Dynamic (Filtered) Exports
```bash
# Uncommon filters - generated dynamically (2-10 seconds)
GET /api/contacts/export?profession=Rare_Profession
GET /api/contacts/export?city=Small_City&interests=Niche_Interest
```

## Error Handling

### Invalid Subscription Level
```json
{
  "success": false,
  "message": "Your current plan only allows filtering by country. Filter 'sex' is not permitted."
}
```

### Invalid Filter Values
```json
{
  "success": false,
  "message": "Invalid age range provided"
}
```

### No Active Subscription
```json
{
  "success": false,
  "message": "Active subscription required to export contacts."
}
```

## Advanced Usage Examples

### Marketing Campaign Targeting
```bash
# Target young professionals in major cities
GET /api/contacts/export?country=Cameroon&city=Yaoundé&minAge=25&maxAge=40&interests=Business

# Target tech enthusiasts
GET /api/contacts/export?interests=Technology&profession=Engineer&language=English
```

### Event Invitation Lists
```bash
# Local business event
GET /api/contacts/export?region=Centre&interests=Business&interests=Entrepreneurship

# Tech conference
GET /api/contacts/export?interests=Technology&profession=Engineer&profession=Developer
```

### Demographic Analysis
```bash
# Gender distribution by region
GET /api/contacts/export?region=Centre&sex=female
GET /api/contacts/export?region=Centre&sex=male

# Age group analysis
GET /api/contacts/export?minAge=18&maxAge=25  # Gen Z
GET /api/contacts/export?minAge=26&maxAge=40  # Millennials
```

## Popular Filter Cache System

### How It Works
The system automatically caches the results of popular filter combinations to improve performance:

- **Automatic Caching**: Popular filters are cached after first use
- **Smart Selection**: Only filters likely to be reused are cached
- **Cache Limit**: Top 10 most popular filter combinations
- **Auto Expiry**: Cache expires after 24 hours
- **Access Tracking**: Most accessed filters are prioritized

### Which Filters Get Cached
- Country-based filters (most common)
- Basic demographic filters (age, gender)
- Date range filters
- Simple combinations of the above

### Cache Performance
- **First request**: 2-10 seconds (generates and caches)
- **Subsequent requests**: 100-500ms (served from cache)
- **Cache hit rate**: ~70-80% for typical usage patterns

### Admin Management
```bash
# Get cache statistics
GET /api/admin/vcf-cache/popular-filters

# Clear popular filter cache
DELETE /api/admin/vcf-cache/popular-filters
```

## Best Practices

1. **Use specific filters** to reduce export size and improve performance
2. **Combine geographic and demographic filters** for better targeting
3. **Test filter combinations** with small datasets first
4. **Monitor export performance** and adjust filters as needed
5. **Reuse popular filter combinations** to benefit from caching
6. **Use country filters** as they're most likely to be cached

## Filter Validation

The system automatically validates:
- Date formats (ISO 8601 preferred)
- Age ranges (positive integers)
- Gender values (male/female)
- Subscription permissions
- Filter combinations

## Rate Limiting

- **Cached exports**: Higher rate limits (fast responses)
- **Filtered exports**: Lower rate limits (resource intensive)
- **Admin users**: Higher limits for all operations
