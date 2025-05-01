export interface MonthlyData {
    name: string;
    users: number;
    subUsers: number;
}

export interface MonthlyData2 {
    name: string;
    subUsers: number;
    nonSubUsers: number;
}



export const convertDatesToMonthlyData = (
  userDates: string[],
  classiqueDates: string[],
  cibleDates: string[]
) => {
  const monthlyCounts: {
    [key: string]: { month: string; Users: number; Classique: number; Cible: number };
  } = {};

  const processDates = (dates: string[], key: 'Users' | 'Classique' | 'Cible') => {
    if (!dates) return;

    dates.forEach((dateString) => {
      try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
          console.warn(`Invalid date string encountered: ${dateString}`);
          return;
        }
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const monthKey = `${year}-${month}`;

        if (!monthlyCounts[monthKey]) {
          monthlyCounts[monthKey] = { month: monthKey, Users: 0, Classique: 0, Cible: 0 };
        }
        monthlyCounts[monthKey][key]++;
      } catch (e) {
        console.error(`Error processing date: ${dateString}`, e);
      }
    });
  };

  processDates(userDates, 'Users');
  processDates(classiqueDates, 'Classique');
  processDates(cibleDates, 'Cible');

  const dataArray = Object.values(monthlyCounts).sort((a, b) => {
    const [yearA, monthA] = a.month.split('-').map(Number);
    const [yearB, monthB] = b.month.split('-').map(Number);
    if (yearA !== yearB) return yearA - yearB;
    return monthA - monthB;
  });

  return dataArray.map(item => {
    const [year, month] = item.month.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    const monthName = date.toLocaleString('default', { month: 'short' });
    const shortYear = year.substring(2);
    return {
      ...item,
      monthLabel: `${monthName} ${shortYear}`,
    };
  });
};


export const convertDatesToMonthlyDataNonSub = (nonSubDates: string[], subDates: string[]): MonthlyData2[] => {
    const monthMap: { [key: string]: { subUsers: number; nonSubUsers: number } } = {};

    const getMonthYear = (dateString: string): string => {
        const date = new Date(dateString);
        const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUNE", "JULY", "AUG", "SEP", "OCT", "NOV", "DEC"];
        return `${monthNames[date.getMonth()]}-${date.getFullYear()}`;
    };

    const initializeMonth = (month: string) => {
        if (!monthMap[month]) {
            monthMap[month] = { subUsers: 0, nonSubUsers: 0 };
        }
    };

    subDates.forEach((userDate) => {
        const month = getMonthYear(userDate);
        initializeMonth(month);
        monthMap[month].subUsers += 1;
    });

    nonSubDates.forEach((nonSubDate) => {
        const month = getMonthYear(nonSubDate);
        initializeMonth(month);
        monthMap[month].nonSubUsers += 1;
    });

    const result: MonthlyData2[] = Object.keys(monthMap).map((month) => ({
        name: month.split("-")[0], // Month name (JAN, FEB, etc.)
        subUsers: monthMap[month].subUsers,
        nonSubUsers: monthMap[month].nonSubUsers,
    }));

    return result;
};