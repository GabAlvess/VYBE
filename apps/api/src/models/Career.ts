import mongoose from 'mongoose';

const opts = { timestamps: true };
const profileSchema = new mongoose.Schema({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, characterId: { type: mongoose.Schema.Types.ObjectId, required: true }, headline: { type: String, default: '', maxlength: 120 }, summary: { type: String, default: '', maxlength: 2000 }, education: { type: [String], default: [] }, experience: { type: [String], default: [] }, skills: { type: [String], default: [] }, languages: { type: [String], default: [] }, resumeFile: { type: String, default: '' }, portfolioUrl: { type: String, default: '' } }, opts);
profileSchema.index({ tenantId: 1, characterId: 1 }, { unique: true });
export const CareerProfile = mongoose.models.CareerProfile ?? mongoose.model('CareerProfile', profileSchema);

const jobSchema = new mongoose.Schema({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, title: { type: String, required: true, maxlength: 120 }, organization: { type: String, required: true, maxlength: 120 }, area: { type: String, required: true, maxlength: 80 }, type: { type: String, enum: ['Estágio', 'Emprego', 'Residência', 'Pesquisa', 'Programa', 'Voluntariado', 'Freelance', 'Outro'], required: true }, location: { type: String, required: true, maxlength: 120 }, description: { type: String, required: true, maxlength: 5000 }, responsibilities: { type: String, default: '', maxlength: 3000 }, requirements: { type: String, default: '', maxlength: 3000 }, deadline: { type: Date, required: true }, openings: { type: Number, min: 1 }, coverUrl: { type: String, default: '' }, status: { type: String, enum: ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED'], default: 'DRAFT' }, recruiterId: { type: mongoose.Schema.Types.ObjectId, required: true } }, opts);
jobSchema.index({ tenantId: 1, status: 1, deadline: 1 });
export const CareerJob = mongoose.models.CareerJob ?? mongoose.model('CareerJob', jobSchema);

const applicationSchema = new mongoose.Schema({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, jobId: { type: mongoose.Schema.Types.ObjectId, required: true }, characterId: { type: mongoose.Schema.Types.ObjectId, required: true }, profileId: { type: mongoose.Schema.Types.ObjectId, required: true }, status: { type: String, enum: ['SUBMITTED', 'UNDER_REVIEW', 'INTERVIEW', 'APPROVED', 'REJECTED', 'WITHDRAWN'], default: 'SUBMITTED' }, history: { type: [{ status: String, changedBy: mongoose.Schema.Types.ObjectId, changedAt: Date, message: String }], default: [] }, documents: { type: [String], default: [] } }, opts);
applicationSchema.index({ tenantId:  1, jobId: 1, characterId: 1 }, { unique: true });
export const CareerApplication = mongoose.models.CareerApplication ?? mongoose.model('CareerApplication', applicationSchema);

const grantSchema = new mongoose.Schema({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, characterId: { type: mongoose.Schema.Types.ObjectId, required: true }, role: { type: String, enum: ['RECRUITER', 'CAREER_ADMIN'], required: true } }, opts);
grantSchema.index({ tenantId: 1, characterId: 1 }, { unique: true });
export const CareerGrant = mongoose.models.CareerGrant ?? mongoose.model('CareerGrant', grantSchema);

const listingSchema = new mongoose.Schema({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, kind: { type: String, enum: ['opportunity', 'mentor', 'notice'], required: true }, title: { type: String, required: true, maxlength: 150 }, description: { type: String, default: '', maxlength: 2000 }, area: { type: String, default: '', maxlength: 80 }, characterId: mongoose.Schema.Types.ObjectId, status: { type: String, default: 'OPEN' } }, opts);
export const CareerListing = mongoose.models.CareerListing ?? mongoose.model('CareerListing', listingSchema);

const requestSchema = new mongoose.Schema({ tenantId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true }, mentorId: { type: mongoose.Schema.Types.ObjectId, required: true }, characterId: { type: mongoose.Schema.Types.ObjectId, required: true }, message: { type: String, maxlength: 1000, default: '' }, status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'], default: 'PENDING' } }, opts);
export const MentorshipRequest = mongoose.models.MentorshipRequest ?? mongoose.model('MentorshipRequest', requestSchema);
