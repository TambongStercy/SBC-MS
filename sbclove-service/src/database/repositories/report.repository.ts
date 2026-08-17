import { FilterQuery, Types } from 'mongoose';
import ReportModel, { IReport } from '../models/report.model';
import { ReportStatus } from '../../types/sbclove.enums';
import logger from '../../utils/logger';

const log = logger.getLogger('ReportRepository');

export class ReportRepository {

    async create(data: {
        reporterId: Types.ObjectId | string;
        reportedUserId: Types.ObjectId | string;
        reportedProfileId: Types.ObjectId | string;
        reason: string;
    }): Promise<IReport> {
        try {
            const report = await ReportModel.create(data);
            log.info(`Report ${report._id} filed by ${data.reporterId} against profile ${data.reportedProfileId}`);
            return report;
        } catch (error: any) {
            if (error.code === 11000) {
                throw new Error('You have already reported this profile.');
            }
            throw error;
        }
    }

    /** Counts distinct reports against a profile (drives auto-suspension). */
    async countForProfile(reportedProfileId: Types.ObjectId | string): Promise<number> {
        return ReportModel.countDocuments({ reportedProfileId }).exec();
    }

    async find(query: FilterQuery<IReport>, limit = 50, skip = 0): Promise<IReport[]> {
        return ReportModel.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean<IReport[]>()
            .exec();
    }

    async count(query: FilterQuery<IReport>): Promise<number> {
        return ReportModel.countDocuments(query).exec();
    }

    async setStatus(
        id: Types.ObjectId | string,
        status: ReportStatus,
        reviewedBy: Types.ObjectId | string
    ): Promise<IReport | null> {
        return ReportModel.findByIdAndUpdate(
            id,
            { status, reviewedBy, reviewedAt: new Date() },
            { new: true }
        ).lean<IReport>().exec();
    }
}

export const reportRepository = new ReportRepository();
